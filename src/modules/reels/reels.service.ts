// src/reels/reels.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Reel, ReelDocument, ReelStatus } from './reel.schema';
import { User, UserDocument } from '../users/user.schema';
import { CreateReelDto } from './dto/create-reel.dto';
import { UpdateReelDto } from './dto/update-reel.dto';
import { DeleteReelDto } from './dto/delete-reel.dto';

@Injectable()
export class ReelsService {
  private readonly logger = new Logger(ReelsService.name);

  constructor(
    @InjectModel(Reel.name) private reelModel: Model<ReelDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  // ✅ Méthode utilitaire pour trouver un utilisateur par différents identifiants
  private async findUserByIdentifier(userId: string): Promise<UserDocument> {
    let user: UserDocument | null = null;

    // 1. Essayer de trouver par ObjectId MongoDB
    if (Types.ObjectId.isValid(userId)) {
      user = await this.userModel.findById(userId).exec();
      if (user) {
        this.logger.debug(`Utilisateur trouvé par ObjectId: ${user.email}`);
        return user;
      }
    }

    // 2. Essayer de trouver par user_id (UUID)
    user = await this.userModel.findOne({ user_id: userId }).exec();
    if (user) {
      this.logger.debug(`Utilisateur trouvé par user_id: ${user.email}`);
      return user;
    }

    // 3. Essayer de trouver par email
    user = await this.userModel.findOne({ email: userId }).exec();
    if (user) {
      this.logger.debug(`Utilisateur trouvé par email: ${user.email}`);
      return user;
    }

    throw new NotFoundException(`Utilisateur non trouvé avec l'identifiant: ${userId}`);
  }

  // ✅ Méthode utilitaire pour obtenir l'ID utilisateur en tant que ObjectId
  private getUserId(user: UserDocument): Types.ObjectId {
    return user._id as Types.ObjectId;
  }

  // ✅ Méthode utilitaire pour comparer les IDs utilisateur
  private compareUserIds(id1: Types.ObjectId | string, id2: Types.ObjectId | string): boolean {
    return id1.toString() === id2.toString();
  }

  // ✅ Créer un nouveau reel
async createReel(userId: string, createReelDto: CreateReelDto): Promise<ReelDocument> {
  try {
    this.logger.log(`Tentative de création de reel pour l'utilisateur: ${userId}`);

    // Trouver l'utilisateur
    const user = await this.findUserByIdentifier(userId);
    const userIdObject = this.getUserId(user);

    let aiCaption = createReelDto.caption;
    let aiHashtags = createReelDto.hashtags || [];

    // Générer le contenu AI si demandé
    if (createReelDto.ai_enhanced) {
      aiHashtags = this.generateAIHashtags(createReelDto.caption, createReelDto.categories);
      aiCaption = this.generateAICaption(createReelDto.caption);
    }

    // Créer le nouveau reel
    const newReel = await this.reelModel.create({
      user_id: userIdObject,
      video_url: createReelDto.video_url,
      thumbnail_url: createReelDto.thumbnail_url,
      video_duration: createReelDto.video_duration || 15,
      caption: aiCaption,
      hashtags: aiHashtags,
      categories: createReelDto.categories || [],
      location: createReelDto.location,
      visibility: createReelDto.visibility || 'public',
      ai_enhanced: createReelDto.ai_enhanced || false,
      ai_caption: createReelDto.ai_enhanced ? aiCaption : undefined,
      ai_hashtags: createReelDto.ai_enhanced ? aiHashtags : undefined,
    });

    // ✅ CORRECTION: Populer et retourner le bon reel
    const populatedReel = await this.reelModel
      .findById(newReel._id)
      .populate('user_id', 'user_id username full_name profile_picture role')
      .exec();

    if (!populatedReel) {
      throw new Error('Failed to populate reel after creation');
    }

    // Mettre à jour le compteur de posts de l'utilisateur
    await this.userModel.findByIdAndUpdate(userIdObject, {
      $inc: { posts_count: 1 }
    });

    this.logger.log(`🎬 Nouveau reel créé par l'utilisateur: ${user.email}`);

    return populatedReel; // ✅ Retourne le reel peuplé

  } catch (error) {
    this.logger.error(`Erreur lors de la création du reel: ${error.message}`);
    throw error;
  }
}

  // ✅ Page "For You" - Algorithm de recommandation
  async getForYouFeed(userId: string, page: number = 1, limit: number = 10) {
    try {
      const user = await this.findUserByIdentifier(userId);
      const skip = (page - 1) * limit;

      const pipeline: any[] = [
        // Étape 1: Filtrer les reels actifs et visibles
        {
          $match: {
            status: ReelStatus.ACTIVE,
            $or: [
              { visibility: 'public' },
              { visibility: 'followers_only' }
            ]
          }
        },
        
        // Étape 2: Populer les données utilisateur
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { 
          $unwind: {
            path: '$user',
            preserveNullAndEmptyArrays: false
          }
        },
        
        // Étape 3: Filtrer les utilisateurs actifs
        {
          $match: {
            'user.account_status': { $in: ['active', 'verified'] }
          }
        },
        
        // Étape 4: Calculer les scores de pertinence
        {
          $addFields: {
            categoryScore: {
              $size: {
                $setIntersection: [user.preferred_categories || [], '$categories']
              }
            },
            popularityScore: {
              $add: [
                { $multiply: ['$likes_count', 1] },
                { $multiply: ['$comments_count', 2] },
                { $multiply: ['$shares_count', 3] },
                { $multiply: ['$views_count', 0.1] }
              ]
            },
            freshnessScore: {
              $divide: [
                1,
                {
                  $add: [
                    1,
                    {
                      $divide: [
                        { $subtract: [new Date(), '$created_at'] },
                        1000 * 60 * 60 // Heures depuis la création
                      ]
                    }
                  ]
                }
              ]
            }
          }
        },
        
        // Étape 5: Calculer le score total
        {
          $addFields: {
            totalScore: {
              $add: [
                { $multiply: ['$categoryScore', 10] },
                { $multiply: ['$popularityScore', 0.1] },
                { $multiply: ['$freshnessScore', 5] }
              ]
            }
          }
        },
        
        // Étape 6: Trier par score
        { 
          $sort: { 
            totalScore: -1, 
            created_at: -1 
          } 
        },
        
        // Étape 7: Pagination
        { $skip: skip },
        { $limit: limit },
        
        // Étape 8: Projection finale
        {
          $project: {
            reel_id: 1,
            video_url: 1,
            thumbnail_url: 1,
            video_duration: 1,
            caption: 1,
            hashtags: 1,
            categories: 1,
            location: 1,
            likes_count: 1,
            comments_count: 1,
            shares_count: 1,
            views_count: 1,
            ai_enhanced: 1,
            created_at: 1,
            'user.user_id': 1,
            'user.username': 1,
            'user.full_name': 1,
            'user.profile_picture': 1,
            'user.role': 1
          }
        }
      ];

      const reels = await this.reelModel.aggregate(pipeline).exec();

      // Incrémenter les vues pour chaque reel
      if (reels && reels.length > 0) {
        const reelIds = reels
          .map((reel: any) => reel._id)
          .filter((id: any) => id !== undefined && id !== null);
        
        await this.incrementViews(reelIds);
      }

      this.logger.log(`Feed "For You" généré pour ${user.email} - ${reels.length} reels`);

      return reels;

    } catch (error) {
      this.logger.error(`Erreur lors de la génération du feed: ${error.message}`);
      throw error;
    }
  }

  // ✅ Mettre à jour un reel
  async updateReel(
    userId: string,
    reelId: string,
    updateReelDto: UpdateReelDto,
  ): Promise<ReelDocument> {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      const reel = await this.reelModel.findOne({ reel_id: reelId }).exec();
      
      if (!reel) {
        throw new NotFoundException('Reel non trouvé');
      }

      // Vérifier que l'utilisateur est le propriétaire du reel
      if (!this.compareUserIds(reel.user_id, userIdObject)) {
        throw new ForbiddenException('Vous ne pouvez pas modifier ce reel');
      }

      if (reel.status !== ReelStatus.ACTIVE) {
        throw new BadRequestException('Impossible de modifier un reel supprimé ou archivé');
      }

      const updates: any = {};

      // Appliquer les mises à jour
      if (updateReelDto.caption !== undefined) {
        updates.caption = updateReelDto.caption;
        
        if (updateReelDto.ai_enhanced) {
          updates.ai_hashtags = this.generateAIHashtags(
            updateReelDto.caption, 
            updateReelDto.categories || reel.categories
          );
          updates.ai_caption = this.generateAICaption(updateReelDto.caption);
          updates.ai_enhanced = true;
        }
      }

      if (updateReelDto.hashtags !== undefined) updates.hashtags = updateReelDto.hashtags;
      if (updateReelDto.categories !== undefined) updates.categories = updateReelDto.categories;
      if (updateReelDto.location !== undefined) updates.location = updateReelDto.location;
      if (updateReelDto.thumbnail_url !== undefined) updates.thumbnail_url = updateReelDto.thumbnail_url;
      if (updateReelDto.visibility !== undefined) updates.visibility = updateReelDto.visibility;
      if (updateReelDto.music_track !== undefined) updates.music_track = updateReelDto.music_track;
      if (updateReelDto.music_artist !== undefined) updates.music_artist = updateReelDto.music_artist;

      const updatedReel = await this.reelModel.findOneAndUpdate(
        { reel_id: reelId },
        { $set: updates },
        { new: true }
      ).populate('user_id', 'user_id username full_name profile_picture role').exec();

      if (!updatedReel) {
        throw new NotFoundException('Reel non trouvé après mise à jour');
      }

      this.logger.log(`Reel mis à jour: ${reelId} par l'utilisateur: ${user.email}`);

      return updatedReel;

    } catch (error) {
      this.logger.error(`Erreur lors de la mise à jour du reel: ${error.message}`);
      throw error;
    }
  }

  // ✅ Supprimer un reel avec raison
  async deleteReel(
    userId: string, 
    reelId: string, 
    deleteReelDto?: DeleteReelDto
  ) {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      const reel = await this.reelModel.findOne({ reel_id: reelId }).exec();
      
      if (!reel) {
        throw new NotFoundException('Reel non trouvé');
      }

      // Vérifier que l'utilisateur est le propriétaire du reel
      if (!this.compareUserIds(reel.user_id, userIdObject)) {
        throw new ForbiddenException('Vous ne pouvez pas supprimer ce reel');
      }

      // Vérifier la confirmation de suppression
      if (deleteReelDto && deleteReelDto.confirmation !== 'DELETE') {
        throw new BadRequestException(
          'Confirmation de suppression invalide. Veuillez écrire "DELETE" pour confirmer.'
        );
      }

      const updateData: any = {
        status: ReelStatus.DELETED,
        updated_at: new Date(),
      };

      // Enregistrer la raison de suppression si fournie
      if (deleteReelDto) {
        updateData.deletion_reason = deleteReelDto.reason;
        updateData.deletion_explanation = deleteReelDto.explanation;
        updateData.deleted_at = new Date();
      }

      await this.reelModel.findOneAndUpdate(
        { reel_id: reelId },
        { $set: updateData }
      ).exec();

      // Décrémenter le compteur de posts de l'utilisateur
      await this.userModel.findByIdAndUpdate(userIdObject, {
        $inc: { posts_count: -1 }
      });

      this.logger.log(`Reel supprimé: ${reelId} par l'utilisateur: ${user.email}`);

      return { 
        message: 'Reel supprimé avec succès',
        deletion_reason: deleteReelDto?.reason 
      };

    } catch (error) {
      this.logger.error(`Erreur lors de la suppression du reel: ${error.message}`);
      throw error;
    }
  }

  // ✅ Archiver un reel
  async archiveReel(userId: string, reelId: string) {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      const reel = await this.reelModel.findOne({ reel_id: reelId }).exec();
      
      if (!reel) {
        throw new NotFoundException('Reel non trouvé');
      }

      if (!this.compareUserIds(reel.user_id, userIdObject)) {
        throw new ForbiddenException('Vous ne pouvez pas archiver ce reel');
      }

      reel.status = ReelStatus.ARCHIVED;
      reel.archived_at = new Date();
      await reel.save();

      this.logger.log(`Reel archivé: ${reelId} par l'utilisateur: ${user.email}`);

      return { message: 'Reel archivé avec succès' };

    } catch (error) {
      this.logger.error(`Erreur lors de l'archivage du reel: ${error.message}`);
      throw error;
    }
  }

  // ✅ Restaurer un reel
  async restoreReel(userId: string, reelId: string) {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      const reel = await this.reelModel.findOne({ reel_id: reelId }).exec();
      
      if (!reel) {
        throw new NotFoundException('Reel non trouvé');
      }

      if (!this.compareUserIds(reel.user_id, userIdObject)) {
        throw new ForbiddenException('Vous ne pouvez pas restaurer ce reel');
      }

      if (reel.status === ReelStatus.ACTIVE) {
        throw new BadRequestException('Le reel est déjà actif');
      }

      // Restaurer le reel
      reel.status = ReelStatus.ACTIVE;
      reel.deletion_reason = undefined;
      reel.deletion_explanation = undefined;
      reel.deleted_at = undefined;
      reel.archived_at = undefined;
      await reel.save();

      // Réincrémenter le compteur de posts de l'utilisateur
      await this.userModel.findByIdAndUpdate(userIdObject, {
        $inc: { posts_count: 1 }
      });

      this.logger.log(`Reel restauré: ${reelId} par l'utilisateur: ${user.email}`);

      return { message: 'Reel restauré avec succès' };

    } catch (error) {
      this.logger.error(`Erreur lors de la restauration du reel: ${error.message}`);
      throw error;
    }
  }

  // ✅ Obtenir les reels de l'utilisateur
  async getUserReels(
    userId: string, 
    includeArchived: boolean = false,
    page: number = 1, 
    limit: number = 10
  ) {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      const skip = (page - 1) * limit;

      const statusFilter = includeArchived 
        ? { status: { $in: [ReelStatus.ACTIVE, ReelStatus.ARCHIVED] } }
        : { status: ReelStatus.ACTIVE };

      const reels = await this.reelModel
        .find({
          user_id: userIdObject,
          ...statusFilter
        })
        .populate('user_id', 'user_id username full_name profile_picture role')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const total = await this.reelModel.countDocuments({
        user_id: userIdObject,
        ...statusFilter
      });

      this.logger.log(`${reels.length} reels récupérés pour l'utilisateur: ${user.email}`);

      return {
        reels,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };

    } catch (error) {
      this.logger.error(`Erreur lors de la récupération des reels utilisateur: ${error.message}`);
      throw error;
    }
  }

  // ✅ Reels tendance
  async getTrendingReels(page: number = 1, limit: number = 10, location?: string) {
    try {
      const skip = (page - 1) * limit;

      const matchStage: any = {
        status: ReelStatus.ACTIVE,
        visibility: 'public'
      };

      if (location) {
        matchStage.location = { $regex: location, $options: 'i' };
      }

      const pipeline: any[] = [
        { $match: matchStage },
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { 
          $unwind: {
            path: '$user',
            preserveNullAndEmptyArrays: false
          }
        },
        {
          $match: {
            'user.account_status': { $in: ['active', 'verified'] }
          }
        },
        {
          $addFields: {
            engagement_score: {
              $add: [
                '$likes_count',
                { $multiply: ['$comments_count', 2] },
                { $multiply: ['$shares_count', 3] }
              ]
            },
            is_recent: {
              $cond: {
                if: { $gte: ['$created_at', new Date(Date.now() - 24 * 60 * 60 * 1000)] },
                then: 1,
                else: 0
              }
            }
          }
        },
        {
          $addFields: {
            trending_score: {
              $add: [
                '$engagement_score',
                { $multiply: ['$is_recent', 100] }
              ]
            }
          }
        },
        { $sort: { trending_score: -1, created_at: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            reel_id: 1,
            video_url: 1,
            thumbnail_url: 1,
            caption: 1,
            hashtags: 1,
            location: 1,
            likes_count: 1,
            comments_count: 1,
            shares_count: 1,
            engagement_score: 1,
            created_at: 1,
            'user.user_id': 1,
            'user.username': 1,
            'user.full_name': 1,
            'user.profile_picture': 1
          }
        }
      ];

      const reels = await this.reelModel.aggregate(pipeline).exec();

      this.logger.log(`${reels.length} reels tendance récupérés`);

      return reels;

    } catch (error) {
      this.logger.error(`Erreur lors de la récupération des reels tendance: ${error.message}`);
      throw error;
    }
  }

  // ✅ Reels par catégorie
  async getReelsByCategory(category: string, page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const reels = await this.reelModel
        .find({
          status: ReelStatus.ACTIVE,
          visibility: 'public',
          categories: category
        })
        .populate('user_id', 'user_id username full_name profile_picture role')
        .sort({ likes_count: -1, created_at: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const total = await this.reelModel.countDocuments({
        status: ReelStatus.ACTIVE,
        visibility: 'public',
        categories: category
      });

      this.logger.log(`${reels.length} reels récupérés pour la catégorie: ${category}`);

      return {
        reels,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };

    } catch (error) {
      this.logger.error(`Erreur lors de la récupération des reels par catégorie: ${error.message}`);
      throw error;
    }
  }

  // ✅ Méthodes utilitaires privées
  private async incrementViews(reelIds: Types.ObjectId[]) {
    if (reelIds.length === 0) return;
    
    await this.reelModel.updateMany(
      { _id: { $in: reelIds } },
      { $inc: { views_count: 1 } }
    ).exec();
  }

  private async populateUserData(reel: ReelDocument): Promise<ReelDocument> {
    return await reel.populate('user_id', 'user_id username full_name profile_picture role');
  }

  private generateAIHashtags(caption: string, categories: string[] = []): string[] {
    const hashtags = new Set<string>();
    
    // Ajouter les catégories comme hashtags
    categories.forEach(cat => hashtags.add(cat));
    
    // Extraire les mots-clés de la légende
    const keywords: string[] = caption.toLowerCase().match(/\b\w+\b/g) || [];
    
    keywords.forEach((word: string) => {
      if (word.length > 3 && !['avec', 'dans', 'pour', 'sur', 'sans', 'mon', 'ma', 'mes', 'le', 'la', 'les'].includes(word)) {
        hashtags.add(word);
      }
    });

    // Ajouter des hashtags populaires
    const popularHashtags = ['food', 'cuisine', 'recette', 'delicious', 'yummy', 'foodie', 'cooking'];
    popularHashtags.forEach(tag => hashtags.add(tag));

    return Array.from(hashtags).slice(0, 10);
  }

  private generateAICaption(originalCaption: string): string {
    return `✨ ${originalCaption} \n\n#AIGenerated #FoodContent`;
  }
}