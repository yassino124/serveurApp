// src/modules/ai/reels-ai.service.ts - MISE À JOUR
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { MinimaxVideoService } from './minimax-video.service';
import { ContentModerationService } from '../reels/content-moderation.service';

interface AIReelContent {
  video_url: string;
  thumbnail_url: string;
  ai_caption: string;
  ai_hashtags: string[];
  categories: string[];
  video_metadata: {
    width: number;
    height: number;
    duration: number;
    format: string;
  };
  is_placeholder?: boolean;
  task_id?: string;
}

@Injectable()
export class ReelsAIService {
  private readonly logger = new Logger(ReelsAIService.name);

  constructor(
    private readonly minimaxVideoService: MinimaxVideoService,
    private readonly contentModerationService: ContentModerationService,
  ) {}

  /**
   * Générer un reel complet avec fallback
   */
  async generateAIReel(
    dishName: string,
    cuisine?: string,
    style?: string,
    description?: string
  ): Promise<AIReelContent> {
    try {
      this.logger.log(`🎬 Génération reel AI pour: ${dishName}`);

      // 1. Générer la vidéo (avec fallback automatique)
      const videoResult = await this.minimaxVideoService.generateFoodVideo({
        dishName,
        cuisine,
        style: style || 'cinematic',
        description,
      });

      this.logger.log(`📹 Résultat vidéo: ${videoResult.is_placeholder ? 'PLACEHOLDER' : 'REEL'}`);
      this.logger.log(`🔗 URL: ${videoResult.video_url}`);

      // 2. Générer caption optimisée
      const aiCaption = this.generateOptimizedCaption(
        dishName,
        cuisine,
        description,
        videoResult.is_placeholder
      );

      // 3. Générer hashtags
      const aiHashtags = this.generateOptimizedHashtags(
        dishName,
        cuisine,
        style,
        videoResult.is_placeholder
      );

      // 4. Déterminer catégories
      const categories = this.determineCategories(dishName, cuisine);

      // 5. Métadonnées
      const videoMetadata = {
        width: 1080,
        height: 1920,
        duration: 6,
        format: 'mp4',
      };

      this.logger.log(`✅ Reel AI généré (${videoResult.is_placeholder ? 'simulé' : 'réel'})`);

      return {
        video_url: videoResult.video_url,
        thumbnail_url: videoResult.thumbnail_url,
        ai_caption: aiCaption,
        ai_hashtags: aiHashtags,
        categories,
        video_metadata: videoMetadata,
        is_placeholder: videoResult.is_placeholder,
        task_id: videoResult.task_id,
      };

    } catch (error: any) {
      this.logger.error(`❌ Erreur critique génération reel: ${error.message}`);
      
      // Fallback ultime
      return this.generateFallbackReel(dishName, cuisine, description);
    }
  }

  /**
   * Générer caption avec indication si placeholder
   */
  private generateOptimizedCaption(
    dishName: string,
    cuisine?: string,
    description?: string,
    isPlaceholder: boolean = false
  ): string {
    
    let caption = `✨ ${dishName}`;

    if (cuisine) {
      caption += ` - Cuisine ${cuisine}`;
    }

    if (description) {
      caption += `\n\n${description}`;
    } else {
      caption += `\n\nDécouvrez ce délicieux plat préparé avec soin. 🍽️`;
    }

    if (isPlaceholder) {
      caption += `\n\n🎬 (Vidéo illustrative - Génération AI en cours de configuration)`;
    } else {
      caption += `\n\n#GeneratedByAI #FoodAI`;
    }

    return caption;
  }

  /**
   * Générer des hashtags
   */
  private generateOptimizedHashtags(
    dishName: string,
    cuisine?: string,
    style?: string,
    isPlaceholder: boolean = false
  ): string[] {
    
    const hashtags = new Set<string>([
      'food',
      'foodie',
      'cooking',
      'delicious',
      'foodphotography',
    ]);

    // Nom du plat
    const dishHashtag = dishName.replace(/\s+/g, '').toLowerCase();
    if (dishHashtag.length > 3) {
      hashtags.add(dishHashtag);
    }

    // Cuisine
    if (cuisine) {
      hashtags.add(cuisine.toLowerCase() + 'food');
      hashtags.add(cuisine.toLowerCase() + 'cuisine');
    }

    // Style
    if (style) {
      hashtags.add(style.toLowerCase());
    }

    // Si placeholder, ajouter des tags explicatifs
    if (isPlaceholder) {
      hashtags.add('demo');
      hashtags.add('placeholder');
    } else {
      hashtags.add('AIGenerated');
    }

    // Tags populaires
    const popularTags = [
      'foodlover',
      'instafood',
      'yummy',
      'tasty',
      'homemade',
      'foodstagram',
    ];

    popularTags.slice(0, 3).forEach(tag => hashtags.add(tag));

    return Array.from(hashtags).slice(0, 15);
  }

  /**
   * Fallback ultime si tout échoue
   */
  private generateFallbackReel(
    dishName: string,
    cuisine?: string,
    description?: string
  ): AIReelContent {
    this.logger.warn(`🔄 Utilisation du fallback pour: ${dishName}`);
    
    const dishSlug = dishName.toLowerCase().replace(/\s+/g, '-');
    
    // URLs de placeholder gratuites
    const placeholderVideo = 'https://images.pexels.com/videos/medium/food-cooking-delicious.mp4';
    const placeholderThumbnail = `https://source.unsplash.com/1080x1920/?${dishSlug},food`;
    
    return {
      video_url: placeholderVideo,
      thumbnail_url: placeholderThumbnail,
      ai_caption: `✨ ${dishName}${cuisine ? ` - ${cuisine} Cuisine` : ''}\n\n${description || 'Un délicieux plat à découvrir!'}\n\n🎬 (Mode démonstration)`,
      ai_hashtags: ['food', 'cooking', 'delicious', 'demo', dishSlug],
      categories: ['home_cooking', cuisine || 'general'],
      video_metadata: {
        width: 1080,
        height: 1920,
        duration: 6,
        format: 'mp4',
      },
      is_placeholder: true,
      task_id: 'fallback_' + Date.now(),
    };
  }

  /**
   * Déterminer les catégories (inchangé)
   */
  private determineCategories(dishName: string, cuisine?: string): string[] {
    const categories = new Set<string>();

    // Mapper les cuisines
    const cuisineMapping: { [key: string]: string[] } = {
      tunisian: ['tunisian', 'mediterranean'],
      italian: ['italian', 'mediterranean', 'pasta'],
      french: ['french', 'fine_dining', 'european'],
      // ... reste inchangé
    };

    if (cuisine && cuisineMapping[cuisine.toLowerCase()]) {
      cuisineMapping[cuisine.toLowerCase()].forEach(cat => categories.add(cat));
    }

    // Ajouter au moins une catégorie
    if (categories.size === 0) {
      categories.add('home_cooking');
    }

    return Array.from(categories);
  }

  /**
   * Tester la connexion
   */
  async testMinimaxConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    return await this.minimaxVideoService.testConnection();
  }
}