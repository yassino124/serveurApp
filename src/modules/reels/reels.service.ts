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
import { BoostStatus, BoostType, Reel, ReelDocument, ReelStatus } from './reel.schema';
import { User, UserDocument } from '../users/user.schema';
import { CreateReelDto } from './dto/create-reel.dto';
import { UpdateReelDto } from './dto/update-reel.dto';
import { DeleteReelDto } from './dto/delete-reel.dto';
import { StripeService } from '../stripe/stripe.service'; // Ajouter l'import
import { BoostReelDto, CancelBoostDto } from './dto/boost-reel.dto';


@Injectable()
export class ReelsService {
  private readonly logger = new Logger(ReelsService.name);

  constructor(
    @InjectModel(Reel.name) private reelModel: Model<ReelDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly stripeService: StripeService, // Ajouter StripeService
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
// ✅ REMPLACER CETTE MÉTHODE dans reels.service.ts
async getForYouFeed(userId: string, page: number = 1, limit: number = 10) {
  try {
    const user = await this.findUserByIdentifier(userId);
    const skip = (page - 1) * limit;

    // ✅ ÉTAPE 1: Récupérer les reels BOOSTÉS (max 3 par page)
    const boostedReels = await this.reelModel.aggregate([
      {
        $match: {
          status: ReelStatus.ACTIVE,
          boost_status: BoostStatus.ACTIVE,
          visibility: 'public',
          'boost_details.expires_at': { $gt: new Date() }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          'user.account_status': { $in: ['active', 'verified'] }
        }
      },
      // ✅ Score de boost
      {
        $addFields: {
          boostScore: {
            $add: [
              { $multiply: ['$boost_details.amount', 100] },
              { $subtract: ['$boost_details.max_impressions', '$boosted_impressions'] },
              {
                $cond: {
                  if: { 
                    $gt: [
                      { $size: { $setIntersection: [user.preferred_categories || [], '$boost_details.target_audience'] } },
                      0
                    ]
                  },
                  then: 500,
                  else: 0
                }
              }
            ]
          }
        }
      },
      { $sort: { boostScore: -1, boosted_impressions: 1, last_boosted_at: -1 } },
      { $limit: 3 },
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
          boost_status: 1,
          is_boosted: { $literal: true },
          'user.user_id': 1,
          'user.username': 1,
          'user.full_name': 1,
          'user.profile_picture': 1,
          'user.role': 1
        }
      }
    ]).exec();

    this.logger.log(`🚀 ${boostedReels.length} reels boostés`);

    // ✅ ÉTAPE 2: Reels ORGANIQUES
    const organicLimit = limit - boostedReels.length;

    const organicReels = await this.reelModel.aggregate([
      {
        $match: {
          status: ReelStatus.ACTIVE,
          boost_status: { $ne: BoostStatus.ACTIVE },
          $or: [{ visibility: 'public' }, { visibility: 'followers_only' }]
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          'user.account_status': { $in: ['active', 'verified'] }
        }
      },
      {
        $addFields: {
          categoryScore: { $size: { $setIntersection: [user.preferred_categories || [], '$categories'] } },
          popularityScore: {
            $add: [
              '$likes_count',
              { $multiply: ['$comments_count', 2] },
              { $multiply: ['$shares_count', 3] },
              { $multiply: ['$views_count', 0.1] }
            ]
          },
          freshnessScore: {
            $divide: [1, { $add: [1, { $divide: [{ $subtract: [new Date(), '$created_at'] }, 3600000] }] }]
          }
        }
      },
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
      { $sort: { totalScore: -1, created_at: -1 } },
      { $skip: skip },
      { $limit: organicLimit },
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
          is_boosted: { $literal: false },
          'user.user_id': 1,
          'user.username': 1,
          'user.full_name': 1,
          'user.profile_picture': 1,
          'user.role': 1
        }
      }
    ]).exec();

    this.logger.log(`📦 ${organicReels.length} reels organiques`);

    // ✅ ÉTAPE 3: MÉLANGER (1 boosté tous les 3 organiques)
    const mergedReels: any[] = [];
    let boostIndex = 0;
    let organicIndex = 0;

    while (boostIndex < boostedReels.length || organicIndex < organicReels.length) {
      if (boostIndex < boostedReels.length) {
        mergedReels.push(boostedReels[boostIndex]);
        boostIndex++;
      }

      for (let i = 0; i < 3 && organicIndex < organicReels.length; i++) {
        mergedReels.push(organicReels[organicIndex]);
        organicIndex++;
      }
    }

    // ✅ ÉTAPE 4: Incrémenter vues + impressions boostées
    if (mergedReels.length > 0) {
      const reelIds = mergedReels.map((r: any) => r._id).filter(Boolean);
      await this.incrementViews(reelIds);

      const boostedIds = mergedReels.filter((r: any) => r.is_boosted).map((r: any) => r._id);
      if (boostedIds.length > 0) {
        await this.reelModel.updateMany(
          { _id: { $in: boostedIds } },
          { $inc: { boosted_impressions: 1 } }
        ).exec();

        this.logger.log(`🚀 ${boostedIds.length} impressions boostées incrémentées`);
      }
    }

    this.logger.log(`✅ Feed: ${mergedReels.length} reels (${boostedReels.length} boostés + ${organicReels.length} organiques)`);

    return mergedReels;

  } catch (error) {
    this.logger.error(`❌ Erreur feed: ${error.message}`);
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
// src/modules/reels/reels.service.ts - LIKE CORRIGÉ

// src/modules/reels/reels.service.ts

// ✅ MÉTHODE AMÉLIORÉE pour trouver un reel
  private async findReelByIdentifier(reelId: string): Promise<ReelDocument> {
    this.logger.debug(`🔍 Recherche du reel: ${reelId}`);
    
    let reel: ReelDocument | null = null;

    // 1. Recherche par ObjectId
    if (Types.ObjectId.isValid(reelId)) {
      reel = await this.reelModel.findById(reelId).exec();
      if (reel) {
        this.logger.debug(`✅ Reel trouvé par ObjectId: ${reel._id}`);
        return reel;
      }
    }

    // 2. Recherche par reel_id (UUID)
    reel = await this.reelModel.findOne({ reel_id: reelId }).exec();
    if (reel) {
      this.logger.debug(`✅ Reel trouvé par reel_id: ${reel.reel_id}`);
      return reel;
    }

    // 3. Recherche par ID partiel
    if (reelId.length >= 8) {
      const objectIdRegex = /^[0-9a-fA-F]+$/;
      if (objectIdRegex.test(reelId)) {
        reel = await this.reelModel.findOne({
          _id: { $regex: `^${reelId}`, $options: 'i' }
        }).exec();
        
        if (reel) {
          this.logger.debug(`✅ Reel trouvé par ID partiel: ${reel._id}`);
          return reel;
        }
      }
    }

    this.logger.error(`❌ Reel non trouvé: ${reelId}`);
    throw new NotFoundException(`Reel non trouvé: ${reelId}`);
  }

// Dans ReelsService - likeReel method
async likeReel(userId: string, reelId: string): Promise<{ message: string; likes_count: number; has_liked: boolean }> {
  try {
    this.logger.log(`🎯 LIKE REEL - Début - User: ${userId}, Reel: ${reelId}`);

    // 1. Trouver l'utilisateur
    this.logger.log(`🔍 Recherche utilisateur: ${userId}`);
    const user = await this.findUserByIdentifier(userId);
    if (!user) {
      this.logger.error('❌ Utilisateur non trouvé');
      throw new NotFoundException('Utilisateur non trouvé');
    }
    
    const userIdObject = this.getUserId(user);
    this.logger.log(`✅ Utilisateur trouvé: ${user.email}, ObjectId: ${userIdObject}`);
    
    // 2. Trouver le reel
    this.logger.log(`🔍 Recherche reel: ${reelId}`);
    const reel = await this.findReelByIdentifier(reelId);
    this.logger.log(`✅ Reel trouvé: ${reel._id}, Status: ${reel.status}`);

    // 3. Vérifier le statut du reel
    if (reel.status !== ReelStatus.ACTIVE) {
      this.logger.error(`❌ Reel non actif: ${reel.status}`);
      throw new BadRequestException('Impossible de liker un reel supprimé ou archivé');
    }

    // 4. Vérifier si déjà liké
    this.logger.log(`🔍 Vérification like existant - liked_by: ${reel.liked_by.length} users`);
    const userHasLiked = reel.liked_by.some(likedUserId => {
      const isLiked = likedUserId.toString() === userIdObject.toString();
      this.logger.log(`   → Compare: ${likedUserId.toString()} === ${userIdObject.toString()} = ${isLiked}`);
      return isLiked;
    });

    if (userHasLiked) {
      this.logger.error('❌ Déjà liké');
      throw new BadRequestException('Vous avez déjà liké ce reel');
    }

    // 5. Mettre à jour le reel
    this.logger.log(`🔄 Mise à jour du reel - likes_count avant: ${reel.likes_count}`);
    const updatedReel = await this.reelModel.findByIdAndUpdate(
      reel._id,
      {
        $inc: { likes_count: 1 },
        $addToSet: { liked_by: userIdObject },
        $pull: { unliked_by: userIdObject }
      },
      { new: true }
    ).exec();

    if (!updatedReel) {
      this.logger.error('❌ Reel non trouvé après mise à jour');
      throw new NotFoundException('Reel non trouvé après mise à jour');
    }

    this.logger.log(`✅ Reel mis à jour - likes_count après: ${updatedReel.likes_count}`);

    // 6. Mettre à jour les statistiques
    this.logger.log(`📊 Mise à jour statistiques utilisateur`);
    await this.userModel.findByIdAndUpdate(userIdObject, {
      $inc: { total_likes_given: 1 }
    });

    await this.userModel.findByIdAndUpdate(reel.user_id, {
      $inc: { total_likes_received: 1 }
    });

    this.logger.log(`🎉 LIKE RÉUSSI - Reel: ${reelId}, User: ${user.email}`);

    return {
      message: 'Reel liké avec succès',
      likes_count: updatedReel.likes_count,
      has_liked: true
    };

  } catch (error) {
    this.logger.error(`💥 ERREUR LIKE REEL: ${error.message}`);
    this.logger.error(`💥 Stack: ${error.stack}`);
    
    // Renvoyer l'erreur originale
    throw error;
  }
}

  // ✅ UNLIKE REEL - VERSION SIMPLIFIÉE
  async unlikeReel(userId: string, reelId: string): Promise<{ message: string; likes_count: number; has_liked: boolean }> {
    try {
      this.logger.log(`💔 Unlike reel: ${reelId} par user: ${userId}`);

      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      
      const reel = await this.findReelByIdentifier(reelId);

      // Vérifier si liké
      const userHasLiked = reel.liked_by.some(likedUserId => 
        likedUserId.toString() === userIdObject.toString()
      );

      if (!userHasLiked) {
        throw new BadRequestException('Vous n\'avez pas liké ce reel');
      }

      // Retirer le like
      const updatedReel = await this.reelModel.findByIdAndUpdate(
        reel._id,
        {
          $inc: { likes_count: -1 },
          $pull: { liked_by: userIdObject },
          $addToSet: { unliked_by: userIdObject }
        },
        { new: true }
      ).exec();

      if (!updatedReel) {
        throw new NotFoundException('Reel non trouvé après mise à jour');
      }

      // Mettre à jour les statistiques
      await this.userModel.findByIdAndUpdate(userIdObject, {
        $inc: { total_likes_given: -1 }
      });

      await this.userModel.findByIdAndUpdate(reel.user_id, {
        $inc: { total_likes_received: -1 }
      });

      this.logger.log(`✅ Like retiré - Nouveau count: ${updatedReel.likes_count}`);

      return {
        message: 'Like retiré avec succès',
        likes_count: updatedReel.likes_count,
        has_liked: false
      };

    } catch (error) {
      this.logger.error(`❌ Erreur unlike reel: ${error.message}`);
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      throw new BadRequestException(`Erreur lors du retrait du like: ${error.message}`);
    }
  }

  // ✅ GET LIKE STATUS
  async getLikeStatus(userId: string, reelId: string): Promise<{ has_liked: boolean; likes_count: number }> {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      
      const reel = await this.findReelByIdentifier(reelId);

      if (reel.status !== ReelStatus.ACTIVE) {
        return {
          has_liked: false,
          likes_count: 0
        };
      }

      const hasLiked = reel.liked_by.some(likedUserId => 
        likedUserId.toString() === userIdObject.toString()
      );

      return {
        has_liked: hasLiked,
        likes_count: reel.likes_count || 0
      };

    } catch (error) {
      this.logger.error(`❌ Erreur statut like: ${error.message}`);
      
      if (error instanceof NotFoundException) {
        return {
          has_liked: false,
          likes_count: 0
        };
      }
      
      throw error;
    }
  }

// ✅ Obtenir la liste des utilisateurs qui ont liké
async getReelLikes(reelId: string, page: number = 1, limit: number = 10): Promise<{ users: any[]; total: number }> {
  try {
    const skip = (page - 1) * limit;

    const reel = await this.reelModel.findOne({ reel_id: reelId }).exec();
    
    if (!reel) {
      throw new NotFoundException('Reel non trouvé');
    }

    // Utiliser l'agrégation pour obtenir les utilisateurs qui ont liké
    const pipeline: any[] = [
      {
        $match: { reel_id: reelId }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'liked_by',
          foreignField: '_id',
          as: 'liked_users'
        }
      },
      { $unwind: '$liked_users' },
      {
        $project: {
          'liked_users.user_id': 1,
          'liked_users.username': 1,
          'liked_users.full_name': 1,
          'liked_users.profile_picture': 1,
          'liked_users.bio': 1,
          liked_at: '$created_at' // Utiliser la date de création du like
        }
      },
      { $skip: skip },
      { $limit: limit }
    ];

    const likedUsers = await this.reelModel.aggregate(pipeline).exec();

    // Compter le nombre total de likes
    const total = await this.reelModel.aggregate([
      {
        $match: { reel_id: reelId }
      },
      {
        $project: {
          likes_count: { $size: '$liked_by' }
        }
      }
    ]).exec();

    const totalLikes = total.length > 0 ? total[0].likes_count : 0;

    this.logger.log(`${likedUsers.length} utilisateurs récupérés pour les likes du reel ${reelId}`);

    return {
      users: likedUsers,
      total: totalLikes
    };

  } catch (error) {
    this.logger.error(`Erreur lors de la récupération des likes: ${error.message}`);
    throw error;
  }
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
    // ✅ AJOUT: Ajouter un commentaire
async addComment(
  userId: string,
  reelId: string,
  text: string,
  parentCommentId?: string
): Promise<{ message: string; comment: any; comments_count: number }> {
  try {
    const user = await this.findUserByIdentifier(userId);
    const userIdObject = this.getUserId(user);
    
    const reel = await this.findReelByIdentifier(reelId);

    if (reel.status !== ReelStatus.ACTIVE) {
      throw new BadRequestException('Impossible de commenter un reel inactif');
    }

    const commentData: any = {
      user_id: userIdObject,
      text: text,
      reel_id: reel.reel_id, // ✅ AJOUT: Inclure le reel_id
      created_at: new Date(),
      updated_at: new Date()
    };

    // Si c'est une réponse à un commentaire
    if (parentCommentId) {
      const parentComment = reel.comments.find(
        comment => comment._id?.toString() === parentCommentId
      );

      if (!parentComment) {
        throw new NotFoundException('Commentaire parent non trouvé');
      }

      await this.reelModel.findOneAndUpdate(
        { _id: reel._id, 'comments._id': parentCommentId },
        {
          $push: {
            'comments.$.replies': {
              user_id: userIdObject,
              text: text,
              created_at: new Date()
            }
          },
          $inc: { comments_count: 1 }
        },
        { new: true }
      );

      this.logger.log(`✅ Réponse ajoutée au commentaire ${parentCommentId}`);
    } else {
      // Nouveau commentaire principal
      await this.reelModel.findByIdAndUpdate(
        reel._id,
        {
          $push: { comments: commentData },
          $inc: { comments_count: 1 }
        },
        { new: true }
      );

      this.logger.log(`✅ Nouveau commentaire ajouté au reel ${reelId}`);
    }

    // ✅ CORRECTION 2: Récupérer le reel mis à jour AVEC le populate du user
    const updatedReel = await this.reelModel
      .findById(reel._id)
      .populate('comments.user_id', 'user_id username full_name profile_picture')
      .exec();

    if (!updatedReel) {
      throw new NotFoundException('Reel non trouvé après ajout du commentaire');
    }

    // ✅ CORRECTION 3: Trouver le commentaire nouvellement créé avec les données user
    const newComment = updatedReel.comments[updatedReel.comments.length - 1];

    // ✅ CORRECTION 4: Formater correctement la réponse avec typage
    const populatedUser = newComment.user_id as any; // Cast pour accéder aux propriétés après populate
    
    const formattedComment = {
      _id: newComment._id.toString(),
      user_id: populatedUser._id?.toString() || populatedUser.toString(),
      text: newComment.text,
      reel_id: reel.reel_id,
      parent_comment_id: newComment.parent_comment_id?.toString(),
      replies: newComment.replies || [],
      created_at: newComment.created_at,
      updated_at: newComment.updated_at,
      likes_count: 0,
      user_has_liked: false,
      // ✅ CRUCIAL: Inclure l'objet user complet
      user: {
        user_id: populatedUser.user_id || populatedUser._id?.toString(),
        username: populatedUser.username || 'utilisateur',
        full_name: populatedUser.full_name || 'Utilisateur',
        profile_picture: populatedUser.profile_picture || null
      }
    };

    this.logger.log(`✅ Commentaire formaté avec user: ${formattedComment.user.username}`);

    return {
      message: parentCommentId ? 'Réponse ajoutée avec succès' : 'Commentaire ajouté avec succès',
      comment: formattedComment,
      comments_count: updatedReel.comments_count || 0
    };

  } catch (error) {
    this.logger.error(`❌ Erreur ajout commentaire: ${error.message}`);
    throw error;
  }
}

  // ✅ AJOUT: Supprimer un commentaire
  async deleteComment(
    userId: string,
    reelId: string,
    commentId: string
  ): Promise<{ message: string; comments_count: number }> {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      
      const reel = await this.findReelByIdentifier(reelId);

      // Trouver le commentaire
      const comment = reel.comments.find(c => c._id?.toString() === commentId);
      
      if (!comment) {
        throw new NotFoundException('Commentaire non trouvé');
      }

      // Vérifier les permissions
      const isCommentOwner = comment.user_id.toString() === userIdObject.toString();
      const isReelOwner = reel.user_id.toString() === userIdObject.toString();

      if (!isCommentOwner && !isReelOwner) {
        throw new ForbiddenException('Vous n\'avez pas la permission de supprimer ce commentaire');
      }

      // Supprimer le commentaire
      await this.reelModel.findByIdAndUpdate(
        reel._id,
        {
          $pull: { comments: { _id: commentId } },
          $inc: { comments_count: -1 }
        }
      );

      this.logger.log(`🗑️ Commentaire ${commentId} supprimé du reel ${reelId}`);

      const updatedReel = await this.reelModel.findById(reel._id).exec();

      return {
        message: 'Commentaire supprimé avec succès',
        comments_count: updatedReel?.comments_count || 0
      };

    } catch (error) {
      this.logger.error(`❌ Erreur suppression commentaire: ${error.message}`);
      throw error;
    }
  }

  // ✅ AJOUT: Récupérer les commentaires d'un reel
async getReelComments(
  reelId: string,
  page: number = 1,
  limit: number = 10
): Promise<{ comments: any[]; total: number }> {
  try {
    const reel = await this.reelModel
      .findOne({ reel_id: reelId })
      .populate({
        path: 'comments.user_id',
        select: 'user_id username full_name profile_picture'
      })
      .populate({
        path: 'comments.replies.user_id',
        select: 'user_id username full_name profile_picture'
      })
      .lean() // Important: pour obtenir des objets JavaScript simples
      .exec();

    if (!reel) {
      throw new NotFoundException(`Reel non trouvé avec l'ID: ${reelId}`);
    }

    // Trier les commentaires par date
    const sortedComments = reel.comments.sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime()
    );

    // Pagination
    const skip = (page - 1) * limit;
    const paginatedComments = sortedComments.slice(skip, skip + limit);

    // ✅ FORMATEUR CORRECT POUR LA RÉPONSE
    const formattedComments = paginatedComments.map(comment => {
      // Vérifier si user_id est peuplé
      const user = comment.user_id as any;
      
      return {
        _id: comment._id.toString(),
        user_id: user?._id?.toString() || comment.user_id.toString(),
        text: comment.text,
        reel_id: reel.reel_id,
        parent_comment_id: comment.parent_comment_id?.toString(),
        replies: (comment.replies || []).map((reply: any) => {
          const replyUser = reply.user_id as any;
          
          return {
            _id: reply._id.toString(),
            user_id: replyUser?._id?.toString() || reply.user_id.toString(),
            text: reply.text,
            created_at: reply.created_at,
            likes_count: reply.likes_count || 0,
            user: replyUser ? {
              user_id: replyUser.user_id || replyUser._id?.toString(),
              username: replyUser.username,
              full_name: replyUser.full_name,
              profile_picture: replyUser.profile_picture
            } : null
          };
        }),
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        likes_count: comment.likes_count || 0,
        user_has_liked: comment.user_has_liked || false,
        // ✅ USER FORMATÉ CORRECTEMENT
        user: user ? {
          user_id: user.user_id || user._id?.toString(),
          username: user.username,
          full_name: user.full_name,
          profile_picture: user.profile_picture
        } : null
      };
    });

    return {
      comments: formattedComments,
      total: reel.comments.length
    };
  } catch (error) {
    this.logger.error(`❌ Erreur récupération commentaires: ${error.message}`);
    throw error;
  }
}

  // ✅ AJOUT: Partager un reel
  async shareReel(
    userId: string,
    reelId: string,
    platform: string
  ): Promise<{ message: string; shares_count: number; share_url?: string }> {
    try {
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      
      const reel = await this.findReelByIdentifier(reelId);

      if (reel.status !== ReelStatus.ACTIVE) {
        throw new BadRequestException('Impossible de partager un reel inactif');
      }

      // Vérifier si l'utilisateur a déjà partagé sur cette plateforme
      const alreadyShared = reel.shared_by.some(
        share => share.user_id.toString() === userIdObject.toString() && 
                share.platform === platform
      );

      if (alreadyShared) {
        throw new BadRequestException('Vous avez déjà partagé ce reel sur cette plateforme');
      }

      // Ajouter le partage
      await this.reelModel.findByIdAndUpdate(
        reel._id,
        {
          $push: {
            shared_by: {
              user_id: userIdObject,
              platform: platform,
              shared_at: new Date()
            }
          },
          $inc: { shares_count: 1 }
        },
        { new: true }
      );

      // Générer l'URL de partage
      const shareUrl = this.generateShareUrl(reel, platform);

      this.logger.log(`📤 Reel ${reelId} partagé sur ${platform} par ${user.email}`);

      // Mettre à jour les statistiques utilisateur
      await this.userModel.findByIdAndUpdate(userIdObject, {
        $inc: { total_shares_given: 1 }
      });

      await this.userModel.findByIdAndUpdate(reel.user_id, {
        $inc: { total_shares_received: 1 }
      });

      return {
        message: `Reel partagé sur ${platform} avec succès`,
        shares_count: reel.shares_count + 1,
        share_url: shareUrl
      };

    } catch (error) {
      this.logger.error(`❌ Erreur partage reel: ${error.message}`);
      throw error;
    }
  }

  // ✅ AJOUT: Générer l'URL de partage
  private generateShareUrl(reel: ReelDocument, platform: string): string {
    const baseUrl = process.env.FRONTEND_URL || 'https://yourapp.com';
    const reelUrl = `${baseUrl}/reel/${reel.reel_id}`;
    
    const platformEncoders: { [key: string]: (url: string) => string } = {
      whatsapp: (url) => `https://wa.me/?text=${encodeURIComponent(`Regarde ce reel culinaire ! ${url}`)}`,
      facebook: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      twitter: (url) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Regarde ce reel culinaire !')}`,
      instagram: (url) => url, // Instagram ne supporte pas le partage direct
      copy_link: (url) => url
    };

    return platformEncoders[platform]?.(reelUrl) || reelUrl;
  }

  // ✅ AJOUT: Récupérer les statistiques de partage
  async getShareStats(reelId: string): Promise<{
    total_shares: number;
    by_platform: { [platform: string]: number };
    recent_shares: any[];
  }> {
    try {
      const reel = await this.findReelByIdentifier(reelId);

      // Compter les partages par plateforme
      const byPlatform: { [platform: string]: number } = {};
      reel.shared_by.forEach(share => {
        byPlatform[share.platform] = (byPlatform[share.platform] || 0) + 1;
      });

      // Récupérer les 10 derniers partages
      const recentShares = reel.shared_by
        .sort((a, b) => b.shared_at.getTime() - a.shared_at.getTime())
        .slice(0, 10);

      return {
        total_shares: reel.shares_count,
        by_platform: byPlatform,
        recent_shares: recentShares
      };

    } catch (error) {
      this.logger.error(`❌ Erreur récupération stats partage: ${error.message}`);
      throw error;
    }
  }
    // ✅ MÉTHODE: Booster un reel
  async boostReel(
    userId: string,
    boostReelDto: BoostReelDto
  ): Promise<{
    message: string;
    boost_details: any;
    payment_intent: any;
  }> {
    try {
      this.logger.log(`🚀 Boosting reel: ${boostReelDto.reel_id}`);
      
      // 1. Trouver l'utilisateur
      const user = await this.findUserByIdentifier(userId);
      const userIdObject = this.getUserId(user);
      
      // 2. Trouver le reel
      const reel = await this.findReelByIdentifier(boostReelDto.reel_id);
      
      if (reel.status !== ReelStatus.ACTIVE) {
        throw new BadRequestException('Impossible de booster un reel inactif');
      }
      
      if (reel.boost_status === BoostStatus.ACTIVE) {
        throw new BadRequestException('Ce reel est déjà boosté');
      }
      
      // 3. Calculer les détails du boosting
      const boostAmount = boostReelDto.amount;
      const durationDays = boostReelDto.duration_days || 3;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);
      
      const maxImpressions = this.calculateMaxImpressions(boostAmount);
      
      // 4. Créer le Payment Intent avec Stripe
      let stripeCustomerId = user.stripe_customer_id;
      
      // Créer un customer Stripe si nécessaire
      if (!stripeCustomerId) {
        stripeCustomerId = await this.stripeService.createCustomer({
          email: user.email,
          full_name: user.full_name,
          user_id: user.user_id
        });
        
        // Sauvegarder le customer ID
        await this.userModel.findByIdAndUpdate(userIdObject, {
          stripe_customer_id: stripeCustomerId
        });
      }
      
      // 5. Créer le Payment Intent
      const paymentIntent = await this.stripeService.createPaymentIntent(
        boostAmount,
        stripeCustomerId,
        {
          user_id: user.user_id,
          reel_id: reel.reel_id,
          type: 'reel_boost',
          amount: boostAmount,
          duration_days: durationDays,
          target_audience: boostReelDto.target_audience
        }
      );
      
      // 6. Mettre à jour le reel avec les détails du boosting
      const boostDetails = {
        amount: boostAmount,
        currency: 'USD',
        duration_days: durationDays,
        max_impressions: maxImpressions,
        target_audience: boostReelDto.target_audience || [],
        stripe_payment_intent_id: paymentIntent.payment_intent_id,
        metadata: {
          payment_intent_status: paymentIntent.status,
          user_email: user.email,
          reel_caption: reel.caption.substring(0, 50)
        }
      };
      
      await this.reelModel.findByIdAndUpdate(reel._id, {
        boost_type: BoostType.SPONSORED,
        boost_status: BoostStatus.PENDING,
        boost_details: boostDetails,
        updated_at: new Date()
      });
      
      this.logger.log(`✅ Boosting initialisé pour reel: ${reel.reel_id}`);
      
      return {
        message: 'Boosting initialisé. Confirmez le paiement pour activer.',
        boost_details: boostDetails,
        payment_intent: {
          client_secret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.payment_intent_id,
          status: paymentIntent.status,
          amount: paymentIntent.amount
        }
      };
      
    } catch (error) {
      this.logger.error(`❌ Erreur boosting reel: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ MÉTHODE: Confirmer le boosting après paiement
  async confirmBoostPayment(
    paymentIntentId: string,
    receiptUrl?: string
  ): Promise<{ message: string; reel: any }> {
    try {
      this.logger.log(`✅ Confirmation paiement boosting: ${paymentIntentId}`);
      
      // 1. Trouver le reel par payment intent ID
      const reel = await this.reelModel.findOne({
        'boost_details.stripe_payment_intent_id': paymentIntentId
      }).exec();
      
      if (!reel) {
        throw new NotFoundException('Reel non trouvé pour ce paiement');
      }
      
      // 2. Mettre à jour le statut
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (reel.boost_details?.duration_days || 3));
      
      const updates: any = {
        boost_status: BoostStatus.ACTIVE,
        last_boosted_at: new Date(),
        'boost_details.boosted_at': new Date(),
        'boost_details.expires_at': expiresAt,
        'boost_details.metadata.payment_intent_status': 'succeeded',
        updated_at: new Date()
      };
      
      if (receiptUrl) {
        updates['boost_details.stripe_receipt_url'] = receiptUrl;
      }
      
      const updatedReel = await this.reelModel.findByIdAndUpdate(
        reel._id,
        { $set: updates },
        { new: true }
      ).populate('user_id', 'user_id username full_name profile_picture').exec();
      
      // 3. Loguer la transaction réussie
      this.logger.log(`🎉 Reel boosté avec succès: ${reel.reel_id}`);
      this.logger.log(`💰 Montant: ${reel.boost_details?.amount} USD`);
      this.logger.log(`📅 Expire le: ${expiresAt.toISOString()}`);
      
      // 4. Envoyer notification à l'utilisateur (optionnel)
      await this.sendBoostConfirmationNotification(
        reel.user_id.toString(),
        reel.reel_id,
        reel.boost_details?.amount || 0
      );
      
      return {
        message: 'Reel boosté avec succès!',
        reel: updatedReel
      };
      
    } catch (error) {
      this.logger.error(`❌ Erreur confirmation boosting: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ MÉTHODE: Annuler le boosting
  async cancelBoost(
    userId: string,
    cancelBoostDto: CancelBoostDto
  ): Promise<{ message: string; refund_amount?: number }> {
    try {
      const user = await this.findUserByIdentifier(userId);
      const reel = await this.findReelByIdentifier(cancelBoostDto.reel_id);
      
      // Vérifier les permissions
      const userIdObject = this.getUserId(user);
      if (!this.compareUserIds(reel.user_id as Types.ObjectId | string, userIdObject)) {
        throw new ForbiddenException('Vous ne pouvez pas annuler le boosting de ce reel');
      }
      
      if (reel.boost_status !== BoostStatus.ACTIVE) {
        throw new BadRequestException('Ce reel n\'est pas actuellement boosté');
      }
      
      if (cancelBoostDto.confirmation !== 'CANCEL') {
        throw new BadRequestException('Confirmation invalide');
      }
      
      // Vérifier si on peut rembourser (dans les 24h)
      const boostedAt = reel.boost_details?.boosted_at;
      const now = new Date();
      const hoursSinceBoost = boostedAt ? 
        (now.getTime() - boostedAt.getTime()) / (1000 * 60 * 60) : 0;
      
      let refundAmount = 0;
      
      if (hoursSinceBoost <= 24 && reel.boost_details?.stripe_payment_intent_id) {
        // Remboursement partiel basé sur l'utilisation
        const usedPercentage = reel.boosted_impressions / (reel.boost_details?.max_impressions || 1000);
        const refundPercentage = Math.max(0, 0.7 - usedPercentage); // 70% max de remboursement
        refundAmount = Math.round((reel.boost_details?.amount || 0) * refundPercentage);
        
        if (refundAmount > 0) {
          // TODO: Implémenter le remboursement Stripe
          this.logger.log(`💰 Remboursement de ${refundAmount} USD pour reel ${reel.reel_id}`);
        }
      }
      
      // Mettre à jour le statut
      await this.reelModel.findByIdAndUpdate(reel._id, {
        boost_status: BoostStatus.CANCELLED,
        'boost_details.metadata.cancelled_at': new Date(),
        'boost_details.metadata.refund_amount': refundAmount,
        updated_at: new Date()
      });
      
      return {
        message: 'Boosting annulé avec succès',
        refund_amount: refundAmount > 0 ? refundAmount : undefined
      };
      
    } catch (error) {
      this.logger.error(`❌ Erreur annulation boosting: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ MÉTHODE: Obtenir les statistiques de boosting
  async getBoostStats(
    reelId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    try {
      const reel = await this.findReelByIdentifier(reelId);
      
      if (reel.boost_status !== BoostStatus.ACTIVE) {
        throw new BadRequestException('Ce reel n\'est pas actuellement boosté');
      }
      
      // Calculer les statistiques
      const impressionsRate = reel.boosted_impressions / (reel.boost_details?.max_impressions || 1000);
      const engagementRate = reel.boosted_engagement / Math.max(1, reel.boosted_impressions);
      const cpc = reel.boost_details?.amount / Math.max(1, reel.boosted_clicks); // Cost Per Click
      
      const stats = {
        reel_id: reel.reel_id,
        boost_status: reel.boost_status,
        budget: {
          spent: reel.boost_details?.amount || 0,
          currency: reel.boost_details?.currency || 'USD',
          remaining_days: this.calculateRemainingDays(reel.boost_details?.expires_at)
        },
        performance: {
          impressions: reel.boosted_impressions,
          clicks: reel.boosted_clicks,
          engagement: reel.boosted_engagement,
          max_impressions: reel.boost_details?.max_impressions || 1000,
          impression_rate: Math.round(impressionsRate * 100),
          engagement_rate: Math.round(engagementRate * 100)
        },
        metrics: {
          cpc: cpc.toFixed(2),
          cpm: ((reel.boost_details?.amount || 0) / (reel.boosted_impressions / 1000)).toFixed(2),
          roi: this.calculateROI(reel)
        },
        audience: {
          target: reel.boost_details?.target_audience || [],
          reached: this.calculateAudienceReach(reel)
        },
        timeline: {
          boosted_at: reel.boost_details?.boosted_at,
          expires_at: reel.boost_details?.expires_at,
          duration_days: reel.boost_details?.duration_days
        }
      };
      
      return stats;
      
    } catch (error) {
      this.logger.error(`❌ Erreur stats boosting: ${error.message}`);
      throw error;
    }
  }
  
  // ✅ MÉTHODE: Incrémenter les stats de boosting (à appeler quand le reel est vu)
  async incrementBoostStats(reelId: string, type: 'impression' | 'click' | 'engagement'): Promise<void> {
    try {
      const reel = await this.findReelByIdentifier(reelId);
      
      if (reel.boost_status === BoostStatus.ACTIVE) {
        const update: any = {};
        
        switch (type) {
          case 'impression':
            update.boosted_impressions = 1;
            break;
          case 'click':
            update.boosted_clicks = 1;
            break;
          case 'engagement':
            update.boosted_engagement = 1;
            break;
        }
        
        await this.reelModel.findByIdAndUpdate(
          reel._id,
          { $inc: update }
        ).exec();
      }
    } catch (error) {
      this.logger.error(`❌ Erreur incrément stats: ${error.message}`);
    }
  }
  
  // ✅ MÉTHODE: Obtenir les reels boostés pour le feed
  async getBoostedReelsForFeed(
    userId: string,
    limit: number = 5
  ): Promise<any[]> {
    try {
      const user = await this.findUserByIdentifier(userId);
      
      // Obtenir les reels boostés actifs
      const boostedReels = await this.reelModel
        .find({
          boost_status: BoostStatus.ACTIVE,
          status: ReelStatus.ACTIVE,
          'boost_details.expires_at': { $gt: new Date() }
        })
        .populate('user_id', 'user_id username full_name profile_picture')
        .sort({ 'last_boosted_at': -1, 'boosted_impressions': 1 }) // Priorité aux moins vus
        .limit(limit)
        .exec();
      
      // Filtrer par audience cible si spécifié
      const userInterests: string[] = (user.preferred_categories || []).map((c: any) => String(c));
      const filteredReels = boostedReels.filter(reel => {
        const targetAudience: any[] = reel.boost_details?.target_audience || [];
        
        if (targetAudience.length === 0) return true; // Pas de ciblage spécifique
        
        // Vérifier si l'utilisateur correspond à l'audience cible
        return targetAudience.some((audience: any) => {
          const audStr = String(audience);
          const reelCategories: string[] = (reel.categories || []).map((c: any) => String(c));
          const reelHashtags: string[] = (reel.hashtags || []).map((h: any) => String(h));
          
          return userInterests.includes(audStr) || 
                 reelCategories.includes(audStr) ||
                 reelHashtags.some(tag => tag.includes(audStr));
        });
      });
      
      return filteredReels;
      
    } catch (error) {
      this.logger.error(`❌ Erreur reels boostés: ${error.message}`);
      return [];
    }
  }
  
  // ✅ MÉTHODES UTILITAIRES PRIVÉES
  private calculateMaxImpressions(amount: number): number {
    // Formule: ~100 impressions par USD
    const baseImpressions = 100;
    return Math.round(amount * baseImpressions);
  }
  
  private calculateRemainingDays(expiresAt?: Date): number {
    if (!expiresAt) return 0;
    
    const now = new Date();
    const diffTime = expiresAt.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  
  private calculateROI(reel: ReelDocument): number {
    // ROI simplifié basé sur l'engagement
    const cost = reel.boost_details?.amount || 0;
    const engagementValue = reel.boosted_engagement * 0.01; // Valeur estimée par engagement
    
    if (cost === 0) return 0;
    return Math.round((engagementValue / cost) * 100);
  }
  
  private calculateAudienceReach(reel: ReelDocument): string[] {
    // Simuler le reach d'audience
    const categories = reel.categories || [];
    const hashtags = reel.hashtags || [];
    const target = reel.boost_details?.target_audience || [];
    
    return [...new Set([...categories, ...hashtags.slice(0, 3), ...target])];
  }
  
  private async sendBoostConfirmationNotification(
    userId: string,
    reelId: string,
    amount: number
  ): Promise<void> {
    // TODO: Implémenter l'envoi de notification
    this.logger.log(`📧 Notification boosting envoyée à ${userId} pour reel ${reelId}`);
  }
}