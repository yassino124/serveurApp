//src/modules/reels/reels.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReelsService } from './reels.service';
import { CreateReelDto } from './dto/create-reel.dto';
import { UpdateReelDto } from './dto/update-reel.dto';
import { DeleteReelDto } from './dto/delete-reel.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ContentModerationService } from '../reels/content-moderation.service';
import { CreateReelAIDto } from './dto/create-reel-ai.dto';
import { ValidationPipe, UsePipes } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AddCommentDto } from './dto/add-comment.dto';
import { ShareReelDto } from './dto/share-reel.dto';
import { BoostReelDto, CancelBoostDto } from './dto/boost-reel.dto';

// ✅ Interface pour les réponses standardisées
interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
  pagination?: {
    page: number;
    limit: number;
    total?: number;
    pages?: number;
    has_more: boolean;
  };
}

@ApiTags('Reels')
@ApiBearerAuth('JWT-auth')
@Controller('api/reels')
@UseGuards(JwtAuthGuard)
export class ReelsController {
  private readonly logger = new Logger(ReelsController.name);

  constructor(
    private readonly reelsService: ReelsService,
    private readonly contentModerationService: ContentModerationService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Créer un nouveau reel avec modération automatique' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Reel créé avec succès',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Contenu refusé - non lié à la nourriture',
  })
  @ApiBody({ type: CreateReelDto })
  async createReel(
    @CurrentUser() user: any,
    @Body() createReelDto: CreateReelDto,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`🎬 Tentative de création de reel par user: ${user.user_id}`);
    
    const userId = user.user_id;
    
    if (!userId) {
      throw new Error('User ID not found in authentication token');
    }

    try {
      // ✅ ÉTAPE 1: Analyse du contenu vidéo
      let videoAnalysis: any = null;
      
      if (createReelDto.video_url) {
        this.logger.log(`🎥 Analyse du contenu vidéo...`);
        
        const videoPath = await this.downloadVideoForAnalysis(createReelDto.video_url);
        
        try {
          videoAnalysis = await this.contentModerationService.analyzeVideoContent(
            videoPath,
            'video/mp4'
          );
          
          this.logger.log(`📊 Analyse vidéo: ${JSON.stringify(videoAnalysis)}`);
          
          // Si la vidéo n'est pas liée à la nourriture, rejeter immédiatement
          if (!videoAnalysis.isApproved) {
            this.logger.warn(`❌ Vidéo refusée: ${videoAnalysis.reason}`);
            
            throw new BadRequestException({
              message: 'Contenu vidéo refusé - Cette vidéo ne semble pas être liée à la nourriture',
              reason: videoAnalysis.reason,
              isFoodRelated: videoAnalysis.isFoodRelated,
              confidence: videoAnalysis.confidence,
              detectedContent: videoAnalysis.detectedContent,
            });
          }

          // ✅ Enrichir automatiquement les catégories détectées
          if (videoAnalysis.detectedCategories && videoAnalysis.detectedCategories.length > 0) {
            // Mapper les catégories françaises vers les enum values MongoDB
            const mappedCategories = this.mapCategoriesToEnum(videoAnalysis.detectedCategories);

            const allCategories = [
              ...(createReelDto.categories || []),
              ...mappedCategories
            ];
            createReelDto.categories = [...new Set(allCategories)];
            
            this.logger.log(`📂 Catégories mappées: ${videoAnalysis.detectedCategories.join(', ')} → ${mappedCategories.join(', ')}`);
            this.logger.log(`📂 Catégories finales: ${createReelDto.categories.join(', ')}`);
          }

          // 🆕 GÉNÉRATION AUTOMATIQUE: Caption + Hashtags depuis la vidéo
          this.logger.log(`🤖 Génération automatique du contenu depuis la vidéo...`);
          
          // Générer caption basée sur l'analyse vidéo
          const aiCaption = await this.contentModerationService.generateCaptionFromVideo(
            videoAnalysis.detectedContent || 'Contenu culinaire détecté',
            videoAnalysis.detectedDishes,
            videoAnalysis.detectedCategories
          );
          
          // Générer hashtags optimisés basés sur l'analyse vidéo
          const aiHashtags = await this.contentModerationService.generateHashtagsFromVideo(
            videoAnalysis.detectedContent || 'Contenu culinaire',
            videoAnalysis.detectedCategories,
            videoAnalysis.detectedDishes
          );

          // Remplacer ou garder l'original selon si l'utilisateur a fourni du contenu
          const hasUserCaption = createReelDto.caption && createReelDto.caption.trim().length > 5;
          const hasUserHashtags = createReelDto.hashtags && createReelDto.hashtags.length > 0;

          if (!hasUserCaption || videoAnalysis.confidence > 85) {
            // Si pas de caption utilisateur OU vidéo très claire → utiliser AI
            createReelDto.caption = aiCaption;
            createReelDto.ai_enhanced = true;
            createReelDto.ai_caption = aiCaption;
            this.logger.log(`✨ Caption générée par AI: "${aiCaption}"`);
          }

          if (!hasUserHashtags || videoAnalysis.confidence > 85) {
            // Si pas de hashtags utilisateur OU vidéo très claire → utiliser AI
            createReelDto.hashtags = aiHashtags;
            createReelDto.ai_hashtags = aiHashtags;
            this.logger.log(`🏷️ Hashtags générés par AI: ${aiHashtags.join(', ')}`);
          }

        } finally {
          await this.cleanupTempFile(videoPath);
        }
      }

      // ✅ ÉTAPE 2: Modération du contenu textuel (optionnelle si généré par AI)
      this.logger.log(`🔍 Vérification finale du contenu...`);
      
      const moderationResult = await this.contentModerationService.moderateTextContent(
        createReelDto.caption,
        createReelDto.hashtags,
        createReelDto.categories
      );

      this.logger.log(`📊 Résultat modération: ${JSON.stringify(moderationResult)}`);

      // ✅ ÉTAPE 3: Validation finale (moins stricte car basée sur vidéo)
      // On accepte si la vidéo est food-related, même si le texte a une confiance moyenne
      const videoApproved = videoAnalysis && videoAnalysis.isApproved;
      const textReasonable = !moderationResult.isApproved && moderationResult.confidence < 40;

      if (textReasonable && !videoApproved) {
        // Rejeter seulement si texte vraiment mauvais ET pas de vidéo approuvée
        this.logger.warn(`❌ Contenu textuel suspect: ${moderationResult.reason}`);
        
        throw new BadRequestException({
          message: 'Contenu textuel incompatible avec la plateforme culinaire',
          reason: moderationResult.reason,
          isFoodRelated: moderationResult.isFoodRelated,
          confidence: moderationResult.confidence,
          videoAnalysis: videoAnalysis ? {
            detectedCategories: videoAnalysis.detectedCategories,
            detectedDishes: videoAnalysis.detectedDishes,
          } : null,
        });
      }

      // ✅ ÉTAPE 4: Créer le reel
      this.logger.log(`✅ Contenu approuvé - Création du reel...`);
      const reel = await this.reelsService.createReel(userId, createReelDto);
      
      if (!reel) {
        throw new Error('Failed to create reel: Service returned no data');
      }

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Reel créé avec succès',
        data: {
          ...reel.toObject(),
          moderation: {
            approved: true,
            confidence: videoAnalysis?.confidence || moderationResult.confidence,
            ai_enhanced: createReelDto.ai_enhanced || false,
            ai_generated: {
              caption: createReelDto.ai_caption,
              hashtags: createReelDto.ai_hashtags,
            },
            video_analysis: videoAnalysis ? {
              detected_categories: videoAnalysis.detectedCategories,
              detected_dishes: videoAnalysis.detectedDishes,
              detected_content: videoAnalysis.detectedContent,
              confidence: videoAnalysis.confidence,
            } : null,
          }
        },
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`❌ Erreur création reel: ${error.message}`);
      throw error;
    }
  }

  // ✅ NOUVELLE ROUTE: Générer caption + hashtags depuis vidéo uniquement
  @Post('generate-content-from-video')
  @ApiOperation({ summary: 'Générer caption et hashtags automatiquement depuis la vidéo' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Contenu généré avec succès',
  })
  async generateContentFromVideo(
    @Body() body: { video_url: string }
  ): Promise<ApiResponse<any>> {
    try {
      this.logger.log(`🎥 Génération de contenu depuis vidéo: ${body.video_url}`);
      
      const videoPath = await this.downloadVideoForAnalysis(body.video_url);
      
      try {
        // Analyser la vidéo
        const videoAnalysis = await this.contentModerationService.analyzeVideoContent(
          videoPath,
          'video/mp4'
        );

        if (!videoAnalysis.isApproved) {
          throw new BadRequestException({
            message: 'Vidéo non valide - pas de contenu culinaire détecté',
            analysis: videoAnalysis,
          });
        }

        // Générer caption
        const caption = await this.contentModerationService.generateCaptionFromVideo(
          videoAnalysis.detectedContent,
          videoAnalysis.detectedDishes,
          videoAnalysis.detectedCategories
        );

        // Générer hashtags
        const hashtags = await this.contentModerationService.generateHashtagsFromVideo(
          videoAnalysis.detectedContent,
          videoAnalysis.detectedCategories,
          videoAnalysis.detectedDishes
        );

        return {
          statusCode: HttpStatus.OK,
          message: 'Contenu généré avec succès',
          data: {
            generated_content: {
              caption: caption,
              hashtags: hashtags,
              categories: videoAnalysis.detectedCategories,
            },
            video_analysis: {
              is_food_related: videoAnalysis.isFoodRelated,
              confidence: videoAnalysis.confidence,
              detected_dishes: videoAnalysis.detectedDishes,
              detected_content: videoAnalysis.detectedContent,
            },
          },
        };
      } finally {
        await this.cleanupTempFile(videoPath);
      }

    } catch (error) {
      this.logger.error(`❌ Erreur génération contenu: ${error.message}`);
      throw new BadRequestException('Erreur lors de la génération de contenu');
    }
  }

  // ✅ NOUVELLE ROUTE: Analyser une vidéo avant création
  @Post('analyze-video')
  @ApiOperation({ summary: 'Analyser le contenu d\'une vidéo' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analyse de la vidéo effectuée',
  })
  async analyzeVideo(
    @Body() body: { video_url: string }
  ): Promise<ApiResponse<any>> {
    try {
      this.logger.log(`🎥 Analyse de la vidéo: ${body.video_url}`);
      
      const videoPath = await this.downloadVideoForAnalysis(body.video_url);
      
      try {
        const analysis = await this.contentModerationService.analyzeVideoContent(
          videoPath,
          'video/mp4'
        );

        return {
          statusCode: HttpStatus.OK,
          message: 'Analyse vidéo effectuée',
          data: {
            is_food_related: analysis.isFoodRelated,
            confidence: analysis.confidence,
            detected_categories: analysis.detectedCategories,
            detected_dishes: analysis.detectedDishes,
            detected_content: analysis.detectedContent,
            is_approved: analysis.isApproved,
            reason: analysis.reason,
          },
        };
      } finally {
        await this.cleanupTempFile(videoPath);
      }

    } catch (error) {
      this.logger.error(`❌ Erreur analyse vidéo: ${error.message}`);
      throw new BadRequestException('Erreur lors de l\'analyse de la vidéo');
    }
  }

  // ✅ ROUTE AMÉLIORÉE: Prévisualiser la modération avec analyse vidéo
  @Post('preview-moderation')
  @ApiOperation({ summary: 'Prévisualiser la modération complète (texte + vidéo)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Résultat de la modération',
  })
  async previewModeration(
    @Body() body: { 
      caption: string; 
      hashtags?: string[]; 
      categories?: string[];
      video_url?: string; // 🆕 Optionnel
    }
  ): Promise<ApiResponse<any>> {
    try {
      // Analyse vidéo si fournie
      let videoAnalysis: any = null;
      if (body.video_url) {
        const videoPath = await this.downloadVideoForAnalysis(body.video_url);
        
        try {
          videoAnalysis = await this.contentModerationService.analyzeVideoContent(
            videoPath,
            'video/mp4'
          );
        } finally {
          await this.cleanupTempFile(videoPath);
        }
      }

      // Modération texte
      const result = await this.contentModerationService.moderateTextContent(
        body.caption,
        body.hashtags || [],
        body.categories || []
      );

      let improvedContent: { caption: string; hashtags: string[] } | null = null;
      
      if (result.isFoodRelated && result.confidence < 80) {
        const improvedCaption = await this.contentModerationService.generateFoodCaption(
          body.caption,
          videoAnalysis?.detectedContent || result.detectedContent,
          videoAnalysis?.detectedDishes
        );
        
        const improvedHashtags = await this.contentModerationService.generateFoodHashtags(
          improvedCaption,
          body.categories || [],
          videoAnalysis?.detectedDishes
        );

        improvedContent = {
          caption: improvedCaption,
          hashtags: improvedHashtags,
        };
      }

      return {
        statusCode: HttpStatus.OK,
        message: 'Modération effectuée',
        data: {
          original: {
            caption: body.caption,
            hashtags: body.hashtags,
            categories: body.categories,
          },
          text_moderation: result,
          video_analysis: videoAnalysis ? {
            is_food_related: videoAnalysis.isFoodRelated,
            confidence: videoAnalysis.confidence,
            detected_categories: videoAnalysis.detectedCategories,
            detected_dishes: videoAnalysis.detectedDishes,
            detected_content: videoAnalysis.detectedContent,
          } : null,
          improved: improvedContent,
          final_approval: result.isApproved && (!videoAnalysis || videoAnalysis.isApproved),
        },
      };

    } catch (error) {
      this.logger.error(`Erreur preview modération: ${error.message}`);
      throw new BadRequestException('Erreur lors de la modération');
    }
  }

  // 🛠️ ROUTE DEBUG: Lister les modèles Gemini disponibles
  @Get('debug/models')
  @ApiOperation({ summary: 'Lister tous les modèles Gemini disponibles' })
  async listGeminiModels(): Promise<ApiResponse<any>> {
    try {
      const models = await this.contentModerationService.getAvailableModels();
      
      return {
        statusCode: HttpStatus.OK,
        message: 'Modèles disponibles',
        data: {
          total: models.length,
          models: models,
          recommended_for_vision: models.filter(m => 
            m.includes('1.5') || m.includes('2.0') || m.includes('flash') || m.includes('pro')
          ),
        },
      };
    } catch (error) {
      this.logger.error(`❌ Erreur liste modèles: ${error.message}`);
      throw new BadRequestException('Erreur lors de la récupération des modèles');
    }
  }

  // 🛠️ ROUTE DEBUG: Tester la connexion Gemini
  @Get('debug/test-connection')
  @ApiOperation({ summary: 'Tester la connexion à l\'API Gemini' })
  async testGeminiConnection(): Promise<ApiResponse<any>> {
    try {
      const result = await this.contentModerationService.testConnection();
      
      return {
        statusCode: HttpStatus.OK,
        message: result.success ? 'Connexion réussie' : 'Connexion échouée',
        data: result,
      };
    } catch (error) {
      this.logger.error(`❌ Erreur test connexion: ${error.message}`);
      throw new BadRequestException('Erreur lors du test de connexion');
    }
  }

  // 🛠️ Fonction utilitaire: Mapper catégories FR → EN
  private mapCategoriesToEnum(categories: string[]): string[] {
    const categoryMapping: { [key: string]: string } = {
      // Français → Anglais (enum MongoDB)
      'Recettes': 'home_cooking',
      'Restaurant': 'fine_dining',
      'Street Food': 'street_food',
      'Desserts': 'desserts',
      'Boissons': 'drinks',
      'Végétarien': 'vegetarian',
      'Viandes': 'meat',
      'Poissons & Fruits de mer': 'seafood',
      'Fast Food': 'fast_food',
      'Cuisine Traditionnelle': 'tunisian',
      'Pâtisserie': 'pastries',
      'Pâtes': 'pasta',
      'Pizza': 'pizza',
      'Burger': 'burgers',
      'Burgers': 'burgers',
      'Salades': 'salads',
      'Soupes': 'soups',
      'Grillades': 'grilled',
      'Petit-déjeuner': 'breakfast',
      'Déjeuner': 'lunch',
      'Dîner': 'dinner',
      'Brunch': 'brunch',
      'Snacks': 'snacks',
      'Café': 'coffee',
      'Cocktails': 'cocktails',
      'Healthy': 'healthy',
      'Bio': 'organic',
      'Sans gluten': 'gluten_free',
      'Keto': 'keto',
      'Low Carb': 'low_carb',
      'Vegan': 'vegan',
      'Végétalien': 'vegan',
      'Cuisine Fusion': 'fusion',
      'Boulangerie': 'bakery',
      'Cuisine Japonaise': 'japanese',
      'Cuisine Indienne': 'indian',
      'Cuisine Américaine': 'american',
      'Cuisine Moyen-Orient': 'middle_eastern',
      'Cuisine Mexicaine': 'mexican',
      'Cuisine Asiatique': 'asian',
      'Cuisine Française': 'french',
      'Cuisine Italienne': 'italian',
      'Cuisine Méditerranéenne': 'mediterranean',
      'Cuisine Tunisienne': 'tunisian',
    };

    return categories
      .map(cat => {
        // Si mapping existe, l'utiliser
        if (categoryMapping[cat]) {
          return categoryMapping[cat];
        }
        // Sinon, convertir en snake_case
        return cat.toLowerCase().replace(/\s+/g, '_').replace(/[éèê]/g, 'e').replace(/[à]/g, 'a');
      })
      .filter(cat => cat && cat.length > 0);
  }

  // 🛠️ Fonction utilitaire: Télécharger la vidéo temporairement
  private async downloadVideoForAnalysis(videoUrl: string): Promise<string> {
    const fs = require('fs');
    const path = require('path');
    const axios = require('axios');
    
    // Créer un dossier temporaire
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const fileName = `video_${Date.now()}.mp4`;
    const filePath = path.join(tempDir, fileName);
    
    try {
      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream',
        timeout: 30000, // 30 secondes timeout
      });
      
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      
      return new Promise<string>((resolve, reject) => {
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
      });
    } catch (error: any) {
      this.logger.error(`❌ Erreur téléchargement vidéo: ${error.message}`);
      throw new Error('Impossible de télécharger la vidéo');
    }
  }

  // 🛠️ Fonction utilitaire: Nettoyer le fichier temporaire
  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      const fs = require('fs').promises;
      await fs.unlink(filePath);
      this.logger.debug(`🗑️ Fichier temporaire supprimé: ${filePath}`);
    } catch (error: any) {
      this.logger.warn(`⚠️ Impossible de supprimer le fichier: ${error.message}`);
    }
  }

@Get('for-you')
@ApiOperation({ summary: 'Obtenir le feed "For You" personnalisé' })
@ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
@ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Feed "For You" récupéré avec succès',
})
async getForYouFeed(
  @CurrentUser() user: any,
  @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
  @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
): Promise<ApiResponse<any[]>> {
  
  // ✅ LOGGING CRITIQUE
  this.logger.log('🎬 === DEBUT APPEL /api/reels/for-you ===');
  this.logger.log(`👤 User ID: ${user?.user_id}`);
  this.logger.log(`📊 Query: page=${page}, limit=${limit}`);
  this.logger.log(`🔐 User object: ${JSON.stringify(user)}`);

  const userId = user?.user_id;
  
  if (!userId) {
    this.logger.error('❌ User ID non trouvé dans le token JWT');
    return {
      statusCode: HttpStatus.UNAUTHORIZED,
      message: 'User non authentifié',
      data: [],
    };
  }

  try {
    this.logger.log(`🔍 Appel du service pour user: ${userId}`);
    
    const reels = await this.reelsService.getForYouFeed(userId, page, limit);
    
    this.logger.log(`📦 Résultat du service: ${reels?.length || 0} reels`);
    
    if (!reels || reels.length === 0) {
      this.logger.log(`ℹ️ Aucun reel trouvé pour user ${userId}`);
      return {
        statusCode: HttpStatus.OK,
        message: 'Aucun reel disponible pour le moment',
        data: [],
        pagination: {
          page,
          limit,
          has_more: false,
        },
      };
    }
    
    // ✅ LOG des premiers reels pour debug
    this.logger.log(`✅ ${reels.length} reels trouvés`);
    if (reels.length > 0) {
      this.logger.log(`🎥 Premier reel: ${JSON.stringify(reels[0])}`);
    }
    
    const response = {
      statusCode: HttpStatus.OK,
      message: 'Feed "For You" récupéré avec succès',
      data: reels,
      pagination: {
        page,
        limit,
        has_more: reels.length === limit,
      },
    };
    
    this.logger.log('📤 Réponse envoyée avec succès');
    this.logger.log('🎬 === FIN APPEL /api/reels/for-you ===');
    
    return response;
    
  } catch (error) {
    this.logger.error('❌ ERREUR CRITIQUE dans getForYouFeed:', error);
    this.logger.error('🎬 === ERREUR APPEL /api/reels/for-you ===');
    
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erreur lors de la récupération du feed',
      data: [],
    };
  }
}
// src/modules/reels/reels.controller.ts

@Post(':reelId/like')
@ApiOperation({ summary: 'Liker un reel' })
@ApiParam({ name: 'reelId', type: String, example: '12345' })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Reel liké avec succès',
})
@ApiResponse({
  status: HttpStatus.NOT_FOUND,
  description: 'Reel non trouvé',
})
async likeReel(
  @CurrentUser() user: any,
  @Param('reelId') reelId: string,
): Promise<ApiResponse<any>> {
  const userId = user.user_id;
  const result = await this.reelsService.likeReel(userId, reelId);
  
  return {
    statusCode: HttpStatus.OK,
    message: result.message,
    data: {
      likes_count: result.likes_count,
      has_liked: result.has_liked,
    },
  };
}

@Post(':reelId/unlike')
@ApiOperation({ summary: 'Enlever le like d\'un reel' })
@ApiParam({ name: 'reelId', type: String, example: '12345' })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Like retiré avec succès',
})
@ApiResponse({
  status: HttpStatus.NOT_FOUND,
  description: 'Reel non trouvé',
})
async unlikeReel(
  @CurrentUser() user: any,
  @Param('reelId') reelId: string,
): Promise<ApiResponse<any>> {
  const userId = user.user_id;
  const result = await this.reelsService.unlikeReel(userId, reelId);
  
  return {
    statusCode: HttpStatus.OK,
    message: result.message,
    data: {
      likes_count: result.likes_count,
      has_liked: result.has_liked,
    },
  };
}

@Get(':reelId/like-status')
@ApiOperation({ summary: 'Vérifier le statut de like d\'un reel' })
@ApiParam({ name: 'reelId', type: String, example: '12345' })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Statut de like récupéré avec succès',
})
async getLikeStatus(
  @CurrentUser() user: any,
  @Param('reelId') reelId: string,
): Promise<ApiResponse<any>> {
  const userId = user.user_id;
  const result = await this.reelsService.getLikeStatus(userId, reelId);
  
  return {
    statusCode: HttpStatus.OK,
    message: 'Statut de like récupéré avec succès',
    data: result,
  };
}

@Get(':reelId/likes')
@ApiOperation({ summary: 'Obtenir la liste des utilisateurs qui ont liké le reel' })
@ApiParam({ name: 'reelId', type: String, example: '12345' })
@ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
@ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Liste des likes récupérée avec succès',
})
async getReelLikes(
  @Param('reelId') reelId: string,
  @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
  @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
): Promise<ApiResponse<any[]>> {
  const result = await this.reelsService.getReelLikes(reelId, page, limit);
  
  return {
    statusCode: HttpStatus.OK,
    message: 'Liste des likes récupérée avec succès',
    data: result.users,
    pagination: {
      page,
      limit,
      total: result.total,
      pages: Math.ceil(result.total / limit),
      has_more: page < Math.ceil(result.total / limit),
    },
  };
}
  @Get('trending')
  @ApiOperation({ summary: 'Obtenir les reels tendance' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'location', required: false, type: String, example: 'Tunis' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reels tendance récupérés avec succès',
  })
  async getTrendingReels(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
    @Query('location') location?: string,
  ): Promise<ApiResponse<any[]>> {
    const reels = await this.reelsService.getTrendingReels(page, limit, location);
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Reels tendance récupérés avec succès',
      data: reels || [],  // ✅ Assurer qu'on retourne toujours un tableau
      pagination: {
        page,
        limit,
        has_more: reels ? reels.length === limit : false,
      },
    };
  }

  @Get('category/:category')
  @ApiOperation({ summary: 'Obtenir les reels par catégorie' })
  @ApiParam({ name: 'category', type: String, example: 'tunisian' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reels de la catégorie récupérés avec succès',
  })
  async getReelsByCategory(
    @Param('category') category: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.reelsService.getReelsByCategory(category, page, limit);
    
    return {
      statusCode: HttpStatus.OK,
      message: `Reels de la catégorie ${category} récupérés avec succès`,
      data: result.reels || [],
      pagination: {
        page: result.pagination?.page || page,
        limit: result.pagination?.limit || limit,
        total: result.pagination?.total,
        pages: result.pagination?.pages,
        has_more: result.reels ? result.reels.length === limit : false,
      },
    };
  }

  @Put(':reelId')
  @ApiOperation({ summary: 'Mettre à jour un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reel mis à jour avec succès',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reel non trouvé',
  })
  @ApiBody({ type: UpdateReelDto })
  async updateReel(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
    @Body() updateReelDto: UpdateReelDto,
  ): Promise<ApiResponse<any>> {
    const userId = user.user_id;
    const reel = await this.reelsService.updateReel(userId, reelId, updateReelDto);
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Reel mis à jour avec succès',
      data: reel
    };
  }

  @Delete(':reelId')
  @ApiOperation({ summary: 'Supprimer un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reel supprimé avec succès',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reel non trouvé',
  })
  @ApiBody({ type: DeleteReelDto, required: false })
  async deleteReel(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
    @Body() deleteReelDto?: DeleteReelDto,
  ): Promise<ApiResponse<any>> {
    const userId = user.user_id;
    const result = await this.reelsService.deleteReel(userId, reelId, deleteReelDto);
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        deletion_reason: result.deletion_reason,
      },
    };
  }

  @Post(':reelId/archive')
  @ApiOperation({ summary: 'Archiver un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reel archivé avec succès',
  })
  async archiveReel(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
  ): Promise<ApiResponse<null>> {
    const userId = user.user_id;
    await this.reelsService.archiveReel(userId, reelId);
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Reel archivé avec succès',
      data: null,
    };
  }

  @Post(':reelId/restore')
  @ApiOperation({ summary: 'Restaurer un reel archivé/supprimé' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reel restauré avec succès',
  })
  async restoreReel(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
  ): Promise<ApiResponse<null>> {
    const userId = user.user_id;
    await this.reelsService.restoreReel(userId, reelId);
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Reel restauré avec succès',
      data: null,
    };
  }

  @Get('user/my-reels')
  @ApiOperation({ summary: 'Obtenir mes reels' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'include_archived', required: false, type: Boolean, example: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reels récupérés avec succès',
  })
  async getUserReels(
    @CurrentUser() user: any,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
    @Query('include_archived') includeArchived: boolean = false,
  ): Promise<ApiResponse<any[]>> {
    const userId = user.user_id;
    const result = await this.reelsService.getUserReels(
      userId, 
      includeArchived, 
      page, 
      limit
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Reels récupérés avec succès',
      data: result.reels || [],
      pagination: {
        page: result.pagination?.page || page,
        limit: result.pagination?.limit || limit,
        total: result.pagination?.total,
        pages: result.pagination?.pages,
        has_more: result.reels ? result.reels.length === limit : false,
      },
    };
  }
  
  @Post('upload-test')
  @UseGuards(JwtAuthGuard)
  async testUpload(@Body() body: any): Promise<ApiResponse<any>> {
    this.logger.log('📤 Upload test received:', body);
    
    // Simuler une réponse d'upload réussie
    return {
      statusCode: HttpStatus.OK,
      message: 'Upload simulation successful',
      data: {
        video_url: `https://example.com/videos/${uuidv4()}.mp4`,
        thumbnail_url: `https://example.com/thumbnails/${uuidv4()}.jpg`,
        status: 'success',
      },
    };
  }

@Post('create-with-ai')
@ApiOperation({ summary: 'Créer un reel avec génération vidéo Minimax AI' })
@ApiResponse({
  status: HttpStatus.CREATED,
  description: 'Reel créé avec vidéo AI générée',
})
@ApiResponse({
  status: HttpStatus.BAD_REQUEST,
  description: 'Données invalides ou manquantes',
})
@UsePipes(new ValidationPipe({ 
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true 
}))

// 🆕 ROUTE: Prévisualiser avant génération
@Post('preview-ai-generation')
@ApiOperation({ summary: 'Prévisualiser le contenu qui sera généré' })
async previewAIGeneration(
  @Body() body: {
    dishName: string;
    cuisine?: string;
    style?: string;
    description?: string;
  }
): Promise<ApiResponse<any>> {
  try {
    // Générer caption et hashtags sans créer la vidéo
    const caption = `✨ ${body.dishName}`;
    const hashtags = [
      body.dishName.replace(/\s+/g, '').toLowerCase(),
      'food',
      'ai',
      'cooking',
    ];

    // Déterminer les catégories
    const categories = ['home_cooking'];
    if (body.cuisine) {
      categories.push(body.cuisine.toLowerCase());
    }

    return {
      statusCode: HttpStatus.OK,
      message: 'Prévisualisation générée',
      data: {
        preview_caption: caption,
        preview_hashtags: hashtags,
        estimated_categories: categories,
        style: body.style || 'cinematic',
        estimated_duration: '6 secondes',
        note: 'La vidéo sera générée lors de la création du reel',
      },
    };

  } catch (error) {
    this.logger.error(`❌ Erreur prévisualisation: ${error.message}`);
    throw new BadRequestException('Erreur lors de la prévisualisation');
  }
}
  // ✅ AJOUT: Ajouter un commentaire
  @Post(':reelId/comments')
  @ApiOperation({ summary: 'Ajouter un commentaire à un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiBody({ type: AddCommentDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commentaire ajouté avec succès',
  })
  async addComment(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
    @Body() addCommentDto: AddCommentDto,
  ): Promise<ApiResponse<any>> {
    const userId = user.user_id;
    const result = await this.reelsService.addComment(
      userId, 
      reelId, 
      addCommentDto.text,
      addCommentDto.parent_comment_id
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        comment: result.comment,
        comments_count: result.comments_count,
      },
    };
  }
// Dans reels.controller.ts

@Get('debug/env-config')
@ApiOperation({ summary: 'Vérifier la configuration environnement' })
async checkEnvConfig(): Promise<ApiResponse<any>> {
  const config = {
    minimax: {
      apiKey: process.env.MINIMAX_API_KEY ? '✓ Configuré' : '✗ MANQUANT',
      groupId: process.env.MINIMAX_GROUP_ID ? '✓ Configuré' : '✗ MANQUANT',
      apiKeyPreview: process.env.MINIMAX_API_KEY 
        ? `${process.env.MINIMAX_API_KEY.substring(0, 8)}...` 
        : null,
      groupIdPreview: process.env.MINIMAX_GROUP_ID 
        ? `${process.env.MINIMAX_GROUP_ID.substring(0, 8)}...`
        : null,
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ? '✓' : '✗',
    },
    nodeEnv: process.env.NODE_ENV || 'development',
  };
  
  return {
    statusCode: HttpStatus.OK,
    message: 'Configuration environnement',
    data: config,
  };
}
  // ✅ AJOUT: Supprimer un commentaire
  @Delete(':reelId/comments/:commentId')
  @ApiOperation({ summary: 'Supprimer un commentaire' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiParam({ name: 'commentId', type: String, example: 'comment_123' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commentaire supprimé avec succès',
  })
  async deleteComment(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
    @Param('commentId') commentId: string,
  ): Promise<ApiResponse<any>> {
    const userId = user.user_id;
    const result = await this.reelsService.deleteComment(userId, reelId, commentId);
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        comments_count: result.comments_count,
      },
    };
  }

  // ✅ AJOUT: Récupérer les commentaires d'un reel
  @Get(':reelId/comments')
  @ApiOperation({ summary: 'Récupérer les commentaires d\'un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commentaires récupérés avec succès',
  })
  async getReelComments(
    @Param('reelId') reelId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.reelsService.getReelComments(reelId, page, limit);
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Commentaires récupérés avec succès',
      data: result.comments,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: Math.ceil(result.total / limit),
        has_more: page < Math.ceil(result.total / limit),
      },
    };
  }

  // ✅ AJOUT: Partager un reel
  @Post(':reelId/share')
  @ApiOperation({ summary: 'Partager un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiBody({ type: ShareReelDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reel partagé avec succès',
  })
  async shareReel(
    @CurrentUser() user: any,
    @Param('reelId') reelId: string,
    @Body() shareReelDto: ShareReelDto,
  ): Promise<ApiResponse<any>> {
    const userId = user.user_id;
    const result = await this.reelsService.shareReel(userId, reelId, shareReelDto.platform);
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        shares_count: result.shares_count,
        share_url: result.share_url,
      },
    };
  }

  // ✅ AJOUT: Récupérer les statistiques de partage
  @Get(':reelId/share-stats')
  @ApiOperation({ summary: 'Récupérer les statistiques de partage d\'un reel' })
  @ApiParam({ name: 'reelId', type: String, example: '12345' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Statistiques de partage récupérées avec succès',
  })
  async getShareStats(
    @Param('reelId') reelId: string,
  ): Promise<ApiResponse<any>> {
    const result = await this.reelsService.getShareStats(reelId);
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Statistiques de partage récupérées avec succès',
      data: result,
    };
  }
  // src/modules/reels/reels.controller.ts - AJOUTER CES ROUTES

@Post('boost')
@ApiOperation({ summary: 'Booster un reel (sponsoring direct)' })
@ApiBody({ type: BoostReelDto })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Boosting initialisé, paiement requis',
})
async boostReel(
  @CurrentUser() user: any,
  @Body() boostReelDto: BoostReelDto,
): Promise<ApiResponse<any>> {
  try {
    const result = await this.reelsService.boostReel(
      user.user_id,
      boostReelDto
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        boost_details: result.boost_details,
        payment_intent: result.payment_intent,
        next_steps: 'Utilisez client_secret pour compléter le paiement côté frontend'
      },
    };
  } catch (error) {
    this.logger.error(`❌ Erreur boosting: ${error.message}`);
    throw error;
  }
}

@Post('boost/confirm')
@ApiOperation({ summary: 'Confirmer le boosting après paiement (webhook)' })
@ApiBody({ 
  schema: {
    type: 'object',
    properties: {
      payment_intent_id: { type: 'string', example: 'pi_12345' },
      receipt_url: { type: 'string', example: 'https://receipt.stripe.com/...' }
    }
  }
})
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Boosting confirmé et activé',
})
async confirmBoostPayment(
  @Body() body: { payment_intent_id: string; receipt_url?: string },
): Promise<ApiResponse<any>> {
  try {
    const result = await this.reelsService.confirmBoostPayment(
      body.payment_intent_id,
      body.receipt_url
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: result.reel,
    };
  } catch (error) {
    this.logger.error(`❌ Erreur confirmation boosting: ${error.message}`);
    throw error;
  }
}

@Post('boost/cancel')
@ApiOperation({ summary: 'Annuler le boosting d\'un reel' })
@ApiBody({ type: CancelBoostDto })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Boosting annulé avec succès',
})
async cancelBoost(
  @CurrentUser() user: any,
  @Body() cancelBoostDto: CancelBoostDto,
): Promise<ApiResponse<any>> {
  try {
    const result = await this.reelsService.cancelBoost(
      user.user_id,
      cancelBoostDto
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        refund_amount: result.refund_amount,
        note: result.refund_amount ? 
          `Remboursement de ${result.refund_amount} USD initié` :
          'Pas de remboursement disponible'
      },
    };
  } catch (error) {
    this.logger.error(`❌ Erreur annulation boosting: ${error.message}`);
    throw error;
  }
}

@Get('boost/stats/:reelId')
@ApiOperation({ summary: 'Obtenir les statistiques de boosting d\'un reel' })
@ApiParam({ name: 'reelId', type: String, example: 'reel_12345' })
@ApiQuery({ name: 'start_date', required: false, type: String })
@ApiQuery({ name: 'end_date', required: false, type: String })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Statistiques de boosting récupérées',
})
async getBoostStats(
  @Param('reelId') reelId: string,
  @Query('start_date') startDate?: string,
  @Query('end_date') endDate?: string,
): Promise<ApiResponse<any>> {
  try {
    const stats = await this.reelsService.getBoostStats(
      reelId,
      startDate,
      endDate
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Statistiques de boosting récupérées',
      data: stats,
    };
  } catch (error) {
    this.logger.error(`❌ Erreur stats boosting: ${error.message}`);
    throw error;
  }
}

@Get('boost/active')
@ApiOperation({ summary: 'Obtenir les reels actuellement boostés' })
@ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Reels boostés récupérés',
})
async getActiveBoostedReels(
  @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
): Promise<ApiResponse<any[]>> {
  try {
    const reels = await this.reelsService.getBoostedReelsForFeed(
      'system', // Pour obtenir tous les reels boostés
      limit
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Reels boostés récupérés',
      data: reels,
    };
  } catch (error) {
    this.logger.error(`❌ Erreur reels boostés: ${error.message}`);
    throw error;
  }
}
}