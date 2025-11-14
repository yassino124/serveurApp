import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, AccountStatus } from './user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

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