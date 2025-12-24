import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, AccountStatus } from './user.schema';
import { Reel, ReelDocument, ReelStatus } from '../reels/reel.schema';
import {
  Restaurant,
  RestaurantDocument,
} from '../restaurants/restaurant.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { SetProfilePictureDto } from './dto/set-profile-picture.dto';
import { join, isAbsolute } from 'path';
import * as fs from 'fs';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Reel.name) private reelModel: Model<ReelDocument>,
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
  ) {}

  private async findUserOrThrow(userIdentifier: string) {
    let user = await this.userModel.findOne({ user_id: userIdentifier }).exec();

    if (!user && isValidObjectId(userIdentifier)) {
      user = await this.userModel.findById(userIdentifier).exec();
    }

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    return user;
  }

  // ✅ 1. Voir son profil complet
  async getProfile(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('-password_hash')
      .exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    return user;
  }

  // ✅ 1.b Récupérer le nom/username via un ID utilisateur (UUID ou ObjectId)
  async getUserNameById(userIdentifier: string) {
    const user = await this.findUserOrThrow(userIdentifier);

    return {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
    };
  }

  async getUserReels(userIdentifier: string) {
    const user = await this.findUserOrThrow(userIdentifier);

    const reels = await this.reelModel
      .find({
        user_id: user._id,
        status: { $ne: ReelStatus.DELETED },
      })
      .sort({ created_at: -1 })
      .populate('user_id', 'user_id username full_name profile_picture role')
      .exec();

    return {
      user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
      },
      total: reels.length,
      reels,
    };
  }

  async getUserRestaurants(userIdentifier: string) {
    const user = await this.findUserOrThrow(userIdentifier);

    const restaurants = await this.restaurantModel
      .find({ ownerId: user.user_id })
      .sort({ createdAt: -1 })
      .exec();

    return {
      user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
      },
      total: restaurants.length,
      restaurants,
    };
  }

  // ✅ 2. Mettre à jour le profil (username, nom, bio, photo, catégories)
  async updateProfile(
    userId: string,
    updateDto: UpdateProfileDto & { profile_picture?: string },
  ) {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Vérifier si le nouveau username existe déjà
    if (updateDto.username && updateDto.username !== user.username) {
      const existingUser = await this.userModel
        .findOne({ username: updateDto.username.toLowerCase() })
        .exec();

      if (existingUser) {
        throw new ConflictException("Ce nom d'utilisateur est déjà pris");
      }
    }

    // Mettre à jour les champs
    if (updateDto.username) user.username = updateDto.username.toLowerCase();
    if (updateDto.full_name) user.full_name = updateDto.full_name;
    if (updateDto.bio !== undefined) user.bio = updateDto.bio;
    if (updateDto.profile_picture) user.profile_picture = updateDto.profile_picture;
    if (updateDto.preferred_categories) {
      user.preferred_categories = updateDto.preferred_categories;
    }

    await user.save();

    this.logger.log(`Profile updated for user: ${user.email}`);

    const { password_hash, ...userWithoutPassword } = user.toObject();
    return userWithoutPassword;
  }

  // ✅ 2.b. Changer la photo de profil (URL externe ou image par défaut)
  async setProfilePicture(
    userId: string,
    setPictureDto: SetProfilePictureDto,
  ) {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Vérifier qu'au moins un des deux champs est fourni
    if (!setPictureDto.default_image && !setPictureDto.external_url) {
      throw new BadRequestException(
        'Vous devez fournir soit une URL externe, soit une image par défaut (p2, p3, p4, p5)',
      );
    }

    // Vérifier qu'un seul des deux champs est fourni
    if (setPictureDto.default_image && setPictureDto.external_url) {
      throw new BadRequestException(
        'Vous ne pouvez fournir qu\'une seule option : soit une URL externe, soit une image par défaut',
      );
    }

    let profilePicturePath: string;

    if (setPictureDto.default_image) {
      // Construire le chemin vers l'image par défaut
      // Les images sont servies via /uploads/profiles/pX.jpg
      profilePicturePath = `profiles/${setPictureDto.default_image}.jpg`;
    } else if (setPictureDto.external_url) {
      // Utiliser l'URL externe directement
      profilePicturePath = setPictureDto.external_url;
    } else {
      throw new BadRequestException('Aucune photo valide fournie');
    }

    // Mettre à jour la photo de profil
    user.profile_picture = profilePicturePath;
    await user.save();

    this.logger.log(
      `Profile picture updated for user: ${user.email} - ${profilePicturePath}`,
    );

    const { password_hash, ...userWithoutPassword } = user.toObject();
    return userWithoutPassword;
  }

  // ✅ 2.c. Récupérer le chemin/URL de l'image de profil d'un utilisateur
  async getUserProfilePicture(
    userIdentifier: string,
  ): Promise<
    | { type: 'external'; url: string }
    | { type: 'local'; path: string; relativePath: string }
  > {
    const user = await this.findUserOrThrow(userIdentifier);

    if (!user.profile_picture) {
      throw new NotFoundException('L\'utilisateur n\'a pas de photo de profil');
    }

    // Si c'est une URL externe, retourner l'URL
    if (
      user.profile_picture.startsWith('http://') ||
      user.profile_picture.startsWith('https://')
    ) {
      return {
        type: 'external',
        url: user.profile_picture,
      };
    }

    // Si c'est une image locale, construire le chemin complet
    const uploadsDir = process.env.UPLOAD_PATH || './uploads';
    let imagePath: string;

    // Construire le chemin absolu
    if (uploadsDir.startsWith('./') || !isAbsolute(uploadsDir)) {
      // Chemin relatif, le convertir en absolu depuis process.cwd()
      const absoluteUploadsDir = join(process.cwd(), uploadsDir.replace('./', ''));
      imagePath = join(absoluteUploadsDir, user.profile_picture);
    } else {
      // Chemin absolu
      imagePath = join(uploadsDir, user.profile_picture);
    }

    // Vérifier si le fichier existe
    if (!fs.existsSync(imagePath)) {
      this.logger.warn(
        `Image introuvable pour l'utilisateur ${userIdentifier}: ${imagePath}`,
      );
      throw new NotFoundException(
        'Image de profil introuvable sur le serveur',
      );
    }

    return {
      type: 'local',
      path: imagePath,
      relativePath: user.profile_picture,
    };
  }

  // ✅ 3. Changer le mot de passe (avec vérification de l'ancien)
  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.userModel
      .findById(userId)
      .select('+password_hash')
      .exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Vérifier l'ancien mot de passe
    const isOldPasswordValid = await bcrypt.compare(
      changePasswordDto.current_password,
      user.password_hash,
    );

    if (!isOldPasswordValid) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    // Vérifier que le nouveau mot de passe est différent de l'ancien
    const isSamePassword = await bcrypt.compare(
      changePasswordDto.new_password,
      user.password_hash,
    );

    if (isSamePassword) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent de l\'ancien',
      );
    }

    // Hash et sauvegarder le nouveau mot de passe
    user.password_hash = await bcrypt.hash(changePasswordDto.new_password, 12);
    await user.save();

    this.logger.log(`Password changed for user: ${user.email}`);

    return { message: 'Mot de passe modifié avec succès' };
  }

  // ✅ 4. Changer l'email
  async changeEmail(userId: string, changeEmailDto: ChangeEmailDto) {
    const user = await this.userModel
      .findById(userId)
      .select('+password_hash')
      .exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(
      changeEmailDto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Mot de passe incorrect');
    }

    // Vérifier si le nouvel email existe déjà
    const existingUser = await this.userModel
      .findOne({ email: changeEmailDto.new_email.toLowerCase() })
      .exec();

    if (existingUser) {
      throw new ConflictException('Cet email est déjà utilisé');
    }

    user.email = changeEmailDto.new_email.toLowerCase();
    user.account_status = AccountStatus.PENDING; // Nécessite re-vérification
    await user.save();

    this.logger.log(`Email changed for user: ${user.user_id}`);

    return {
      message: 'Email modifié avec succès. Veuillez vérifier votre nouvelle adresse.',
    };
  }

   // ✅ 5. Désactiver le compte (SUSPENDED - réversible)
  async suspendAccount(userId: string) {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.account_status === AccountStatus.SUSPENDED) {
      throw new BadRequestException('Le compte est déjà désactivé');
    }

    if (user.account_status === AccountStatus.PENDING_DELETION) {
      throw new BadRequestException(
        'Le compte est en cours de suppression. Utilisez /users/recover pour annuler.'
      );
    }

    user.account_status = AccountStatus.SUSPENDED;
    user.suspended_at = new Date();
    await user.save();

    this.logger.log(`Account suspended for user: ${user.email}`);

    return {
      message: 'Compte désactivé avec succès. Vous pouvez le réactiver à tout moment.',
    };
  }

  // ✅ 6. Réactiver le compte
  async reactivateAccount(userId: string) {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.account_status !== AccountStatus.SUSPENDED) {
      throw new BadRequestException(
        'Seuls les comptes suspendus peuvent être réactivés. ' +
        'Utilisez /users/recover pour annuler une suppression.'
      );
    }

    user.account_status = AccountStatus.ACTIVE;
    user.suspended_at = undefined;
    await user.save();

    this.logger.log(`Account reactivated for user: ${user.email}`);

    return { message: 'Compte réactivé avec succès' };
  }

  // ✅ 7. Demander la suppression (soft delete avec 30 jours de grâce)
  async requestAccountDeletion(userId: string, deleteDto: DeleteAccountDto) {
    const user = await this.userModel
      .findById(userId)
      .select('+password_hash')
      .exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Vérifier le mot de passe
    const isPasswordValid = await bcrypt.compare(
      deleteDto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Mot de passe incorrect. Suppression annulée.',
      );
    }

    if (user.account_status === AccountStatus.PENDING_DELETION) {
      throw new BadRequestException(
        'Suppression déjà demandée. Utilisez /users/recover pour annuler.'
      );
    }

    // ✅ Calculer la date de suppression définitive (30 jours)
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 30);

    user.account_status = AccountStatus.PENDING_DELETION;
    user.deletion_requested_at = new Date();
    user.scheduled_deletion_date = deletionDate;
    await user.save();

    this.logger.warn(
      `Account deletion requested for user: ${user.email}. Scheduled for: ${deletionDate.toISOString()}`
    );

    return {
      message: `Suppression programmée pour le ${deletionDate.toLocaleDateString('fr-FR')}. Vous avez 30 jours pour annuler via /users/recover.`,
      scheduled_deletion_date: deletionDate,
      days_remaining: 30,
    };
  }

  // ✅ 8. Récupérer un compte en attente de suppression
  async recoverAccount(userId: string) {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.account_status !== AccountStatus.PENDING_DELETION) {
      throw new BadRequestException(
        'Seuls les comptes en attente de suppression peuvent être récupérés.'
      );
    }

    // ✅ Annuler la suppression et réactiver le compte
    user.account_status = AccountStatus.ACTIVE;
    user.deletion_requested_at = undefined;
    user.scheduled_deletion_date = undefined;
    await user.save();

    this.logger.log(`Account recovered from deletion: ${user.email}`);

    return {
      message: 'Compte récupéré avec succès. Votre suppression a été annulée.',
    };
  }

  // ✅ 9. Supprimer définitivement (fonction interne pour le cron job)
  async permanentlyDeleteExpiredAccounts() {
    const now = new Date();

    // ✅ Trouver tous les comptes dont la date de suppression est dépassée
    const accountsToDelete = await this.userModel
      .find({
        account_status: AccountStatus.PENDING_DELETION,
        scheduled_deletion_date: { $lte: now },
      })
      .exec();

    for (const user of accountsToDelete) {
      this.logger.warn(
        `Permanently deleting account: ${user.email} (scheduled: ${user.scheduled_deletion_date})`
      );
      await this.userModel.findByIdAndDelete(user._id).exec();
    }

    return {
      deleted_count: accountsToDelete.length,
      deleted_emails: accountsToDelete.map(u => u.email),
    };
  }
}