import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import * as fs from 'fs';

export interface ContentModerationResult {
  isApproved: boolean;
  isFoodRelated: boolean;
  confidence: number;
  reason?: string;
  suggestions?: string[];
  detectedContent?: string;
  alternativeCaption?: string;
  suggestedHashtags?: string[];
  detectedCategories?: string[]; // 🆕 Catégories détectées
  detectedDishes?: string[]; // 🆕 Plats détectés
}

@Injectable()
export class ContentModerationService {
  private readonly logger = new Logger(ContentModerationService.name);
  private genAI: GoogleGenerativeAI;
  private apiKey: string;
  private workingModel: string | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    
    if (!apiKey) {
      this.logger.error('❌ GEMINI_API_KEY non définie dans .env');
      throw new Error('Configuration Gemini manquante');
    }
    
    this.apiKey = apiKey;
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.logger.log('✅ Service de modération initialisé');
  }

  // Générer avec REST API
  private async generateWithREST(modelName: string, prompt: string): Promise<string> {
    try {
      this.logger.debug(`🔄 Tentative avec modèle: ${modelName}`);
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          }
        },
        { 
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Aucune réponse générée par le modèle');
      }
      
      this.logger.debug(`✅ Réponse obtenue de ${modelName}`);
      return text;
      
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;
      
      this.logger.warn(`⚠️ Échec ${modelName}: ${status} - ${message}`);
      
      if (status === 403) {
        throw new Error('Clé API invalide ou accès refusé');
      }
      if (status === 429) {
        throw new Error('Limite de taux dépassée');
      }
      
      throw error;
    }
  }

  // 🆕 Générer avec vision (image/vidéo)
  private async generateWithVision(
    modelName: string, 
    prompt: string, 
    fileData: string, 
    mimeType: string
  ): Promise<string> {
    try {
      this.logger.debug(`🔄 Analyse visuelle avec: ${modelName}`);
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`,
        {
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: fileData
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.4,
            topK: 32,
            topP: 0.95,
            maxOutputTokens: 1024,
          }
        },
        { 
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000 // 30 secondes pour l'analyse vidéo
        }
      );

      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Aucune réponse générée par le modèle');
      }
      
      this.logger.debug(`✅ Analyse visuelle réussie`);
      return text;
      
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.error?.message || error.message;
      
      this.logger.warn(`⚠️ Échec analyse visuelle: ${status} - ${message}`);
      throw error;
    }
  }

  // Récupérer la liste des modèles disponibles
  private async listAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`,
        { timeout: 5000 }
      );

      const models = response.data.models
        ?.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', '')) || [];

      this.logger.log(`📋 Modèles disponibles: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`);
      return models;
    } catch (error: any) {
      this.logger.warn(`⚠️ Impossible de lister les modèles: ${error.message}`);
      
      // Fallback sur les noms standards connus de Gemini (Décembre 2024)
      return [
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro-latest', 
        'gemini-2.0-flash-exp',
        'gemini-exp-1206',
        'gemini-1.5-flash-8b-latest'
      ];
    }
  }

  // Générer avec fallback
  private async generateWithFallback(prompt: string): Promise<string> {
    let models: string[] = [];
    
    if (!this.workingModel) {
      models = await this.listAvailableModels();
      
      // Si aucun modèle récupéré, utiliser les noms standards
      if (models.length === 0) {
        models = [
          'gemini-1.5-flash-latest',
          'gemini-1.5-pro-latest',
          'gemini-2.0-flash-exp',
          'gemini-exp-1206',
          'gemini-1.5-flash',
          'gemini-1.5-pro',
          'gemini-pro'
        ];
      }
    } else {
      models = [this.workingModel];
    }
    
    if (this.workingModel && models.includes(this.workingModel)) {
      try {
        return await this.generateWithREST(this.workingModel, prompt);
      } catch (error) {
        this.logger.warn(`⚠️ Le modèle ${this.workingModel} ne fonctionne plus`);
        this.workingModel = null;
      }
    }

    const errors: string[] = [];
    for (const model of models) {
      try {
        const result = await this.generateWithREST(model, prompt);
        this.workingModel = model;
        this.logger.log(`✅ Modèle fonctionnel trouvé: ${model}`);
        return result;
      } catch (error: any) {
        errors.push(`${model}: ${error.message}`);
        continue;
      }
    }
    
    this.logger.error('❌ Échec de tous les modèles Gemini:');
    errors.forEach(err => this.logger.error(`  - ${err}`));
    
    throw new Error('Aucun modèle Gemini disponible. Vérifiez votre clé API.');
  }

  /**
   * 🆕 Analyser le contenu d'une vidéo/image
   */
  async analyzeVideoContent(
    filePath: string,
    mimeType: string
  ): Promise<ContentModerationResult> {
    try {
      this.logger.log(`🎥 Analyse du fichier: ${filePath}`);

      // Lire le fichier et le convertir en base64
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      const prompt = `Tu es un expert en analyse de contenu culinaire pour les réseaux sociaux.

Analyse cette vidéo/image et détermine:
1. Si c'est lié à la nourriture/cuisine (is_food_related: true/false)
2. Le niveau de confiance (confidence: 0-100)
3. Les catégories culinaires détectées (detected_categories: tableau)
4. Les plats/ingrédients identifiés (detected_dishes: tableau)
5. Une description du contenu (detected_content: string)

CATÉGORIES POSSIBLES:
- "Recettes" : préparation d'un plat
- "Restaurant" : plat servi dans un restaurant
- "Street Food" : nourriture de rue
- "Desserts" : pâtisseries, gâteaux, sucreries
- "Boissons" : jus, smoothies, cocktails, café
- "Végétarien" : plats sans viande
- "Viandes" : plats à base de viande
- "Poissons & Fruits de mer" : plats de la mer
- "Fast Food" : burgers, pizzas, etc.
- "Cuisine Traditionnelle" : plats traditionnels
- "Pâtisserie" : création de pâtisserie
- "Autre" : autre contenu culinaire

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans texte avant/après):
{
  "is_food_related": true,
  "confidence": 95,
  "detected_categories": ["Recettes", "Desserts"],
  "detected_dishes": ["Gâteau au chocolat", "Ganache"],
  "detected_content": "Préparation d'un gâteau au chocolat avec glaçage",
  "is_appropriate": true,
  "reason": null
}

Si ce n'est PAS de la nourriture:
{
  "is_food_related": false,
  "confidence": 90,
  "detected_categories": [],
  "detected_dishes": [],
  "detected_content": "Contenu non culinaire détecté",
  "is_appropriate": false,
  "reason": "Ce contenu n'est pas lié à la nourriture"
}`;

      // 🔍 D'abord lister les modèles disponibles avec support vision
      this.logger.log(`🔍 Récupération des modèles disponibles...`);
      const availableModels = await this.listAvailableModels();
      
      // Filtrer les modèles avec vision (ceux qui supportent les images/vidéos)
      let visionModels = availableModels.filter(model => 
        model.includes('gemini') && 
        (model.includes('1.5') || model.includes('2.0') || model.includes('pro') || model.includes('flash'))
      );

      // Si aucun modèle trouvé, utiliser les noms standards connus
      if (visionModels.length === 0) {
        visionModels = [
          'gemini-1.5-flash-latest',
          'gemini-1.5-pro-latest',
          'gemini-2.0-flash-exp',
          'gemini-exp-1206'
        ];
      }

      this.logger.log(`📋 Modèles vision à tester: ${visionModels.join(', ')}`);
      
      let result: string | null = null;
      const errors: string[] = [];
      
      for (const model of visionModels) {
        try {
          this.logger.log(`🎯 Tentative avec: ${model}`);
          result = await this.generateWithVision(model, prompt, base64Data, mimeType);
          this.logger.log(`✅ Succès avec le modèle: ${model}`);
          break;
        } catch (error: any) {
          const errorMsg = error.message || 'Erreur inconnue';
          errors.push(`${model}: ${errorMsg}`);
          this.logger.warn(`⚠️ Échec avec ${model}: ${errorMsg}`);
          continue;
        }
      }

      if (!result) {
        this.logger.error('❌ Tous les modèles vision ont échoué:');
        errors.forEach(err => this.logger.error(`  - ${err}`));
        throw new Error(`Échec de tous les modèles vision. Essayé: ${visionModels.join(', ')}`);
      }

      // Parser le JSON
      let jsonString = result.trim();
      jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      const analysis = JSON.parse(jsonString);

      const moderationResult: ContentModerationResult = {
        isApproved: analysis.is_food_related && analysis.is_appropriate,
        isFoodRelated: analysis.is_food_related,
        confidence: analysis.confidence,
        reason: analysis.reason || undefined,
        detectedContent: analysis.detected_content,
        detectedCategories: analysis.detected_categories || [],
        detectedDishes: analysis.detected_dishes || [],
      };

      this.logger.log(`📊 Analyse vidéo: ${moderationResult.isApproved ? '✅' : '❌'} (confiance: ${moderationResult.confidence}%)`);
      this.logger.log(`📂 Catégories détectées: ${moderationResult.detectedCategories?.join(', ')}`);
      this.logger.log(`🍽️ Plats détectés: ${moderationResult.detectedDishes?.join(', ')}`);
      
      return moderationResult;

    } catch (error: any) {
      this.logger.error(`❌ Erreur analyse vidéo: ${error.message}`);
      
      return {
        isApproved: false,
        isFoodRelated: false,
        confidence: 0,
        reason: `Erreur d'analyse: ${error.message}`,
        detectedCategories: [],
        detectedDishes: [],
      };
    }
  }

  /**
   * Modérer le contenu textuel (caption + hashtags)
   */
  async moderateTextContent(
    caption: string,
    hashtags: string[] = [],
    categories: string[] = []
  ): Promise<ContentModerationResult> {
    try {
      const hashtagsText = hashtags.length > 0 ? hashtags.join(' #') : 'Aucun';
      const categoriesText = categories.length > 0 ? categories.join(', ') : 'Aucune';

      const prompt = `Tu es un modérateur de contenu pour une plateforme de reels culinaires.

Analyse le contenu suivant et détermine:
1. Si c'est lié à la nourriture/cuisine (food-related)
2. Si c'est approprié pour une plateforme culinaire
3. Le niveau de confiance (0-100%)

Caption: "${caption}"
Hashtags: #${hashtagsText}
Catégories: ${categoriesText}

Critères de validation:
✅ ACCEPTÉ si:
- Contenu lié à la nourriture, cuisine, restaurants
- Recettes, plats, ingrédients
- Techniques culinaires
- Expériences gastronomiques
- Critiques de restaurants

❌ REFUSÉ si:
- Contenu sans rapport avec la nourriture
- Contenu inapproprié ou offensant
- Spam ou contenu commercial excessif
- Contenu violent ou sexuel

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans texte avant/après):
{
  "is_food_related": true,
  "is_appropriate": true,
  "confidence": 95,
  "detected_content": "description courte du contenu",
  "reason": "raison du refus si applicable ou null",
  "alternative_caption": "suggestion si refusé ou null",
  "suggested_hashtags": ["foodporn", "cuisine"]
}`;

      const result = await this.generateWithFallback(prompt);
      
      let jsonString = result.trim();
      jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      const analysis = JSON.parse(jsonString);

      const moderationResult = {
        isApproved: analysis.is_food_related && analysis.is_appropriate,
        isFoodRelated: analysis.is_food_related,
        confidence: analysis.confidence,
        reason: analysis.reason || undefined,
        detectedContent: analysis.detected_content,
        alternativeCaption: analysis.alternative_caption || undefined,
        suggestedHashtags: analysis.suggested_hashtags || [],
      };

      this.logger.log(`📊 Modération: ${moderationResult.isApproved ? '✅' : '❌'} (confiance: ${moderationResult.confidence}%)`);
      
      return moderationResult;

    } catch (error: any) {
      this.logger.error(`❌ Erreur modération texte: ${error.message}`);
      
      return {
        isApproved: false,
        isFoodRelated: false,
        confidence: 0,
        reason: `Erreur de modération: ${error.message}. Veuillez réessayer.`,
      };
    }
  }

  /**
   * 🆕 Générer une caption COMPLÈTE basée uniquement sur l'analyse vidéo
   */
  async generateCaptionFromVideo(
    detectedContent?: string,
    detectedDishes?: string[],
    detectedCategories?: string[]
  ): Promise<string> {
    try {
      // Valeur par défaut si detectedContent est undefined
      const content = detectedContent || 'Contenu culinaire détecté';
      
      const dishesInfo = detectedDishes && detectedDishes.length > 0 
        ? `Plats identifiés dans la vidéo: ${detectedDishes.join(', ')}` 
        : '';
      
      const categoriesInfo = detectedCategories && detectedCategories.length > 0
        ? `Catégories: ${detectedCategories.join(', ')}`
        : '';

      const prompt = `Tu es un expert en création de contenu culinaire viral pour les réseaux sociaux (TikTok, Instagram Reels).

🎥 ANALYSE DE LA VIDÉO:
Contenu détecté: ${content}
${dishesInfo}
${categoriesInfo}

📝 MISSION: Génère UNE caption PARFAITE pour cette vidéo culinaire:

✅ RÈGLES:
- Courte et percutante (1-2 phrases MAX, 15-25 mots)
- Commence par un hook qui capte l'attention
- Utilise 2-4 emojis pertinents 🍝🔥✨
- Donne VRAIMENT envie de regarder la vidéo
- Style moderne et engageant
- En français naturel (pas trop formel)
- Focus sur ce qui est VISIBLE dans la vidéo

💡 EXEMPLES DE BON STYLE:
- "Cette technique va changer ta vie 🤯🍕"
- "Le secret des chefs révélé 👨‍🍳✨"
- "Tu ne vas pas croire cette recette 😍🔥"
- "ASMR culinaire parfait 🎧🍰"

⚠️ ÉVITE:
- Les phrases génériques ("Regardez cette recette")
- Les descriptions trop longues
- Le ton commercial

Réponds UNIQUEMENT avec la caption finale, SANS guillemets, SANS explication, SANS markdown.`;

      const result = await this.generateWithFallback(prompt);
      return result.trim().replace(/^["']|["']$/g, '');

    } catch (error: any) {
      this.logger.error(`❌ Erreur génération caption depuis vidéo: ${error.message}`);
      return `Découvrez cette délicieuse recette 🍽️✨`;
    }
  }

  /**
   * Générer une caption améliorée pour contenu culinaire (keep for backward compatibility)
   */
  async generateFoodCaption(
    originalCaption: string,
    detectedContent?: string,
    detectedDishes?: string[]
  ): Promise<string> {
    try {
      const dishesInfo = detectedDishes && detectedDishes.length > 0 
        ? `Plats détectés: ${detectedDishes.join(', ')}` 
        : '';

      const prompt = `Tu es un expert en contenu culinaire pour les réseaux sociaux.

Caption originale: "${originalCaption}"
${detectedContent ? `Contenu détecté: ${detectedContent}` : ''}
${dishesInfo}

Génère UNE caption améliorée et attractive pour un reel culinaire:
- Courte et engageante (1-2 phrases maximum)
- Liée à la nourriture
- Utilise 2-3 emojis appropriés
- Donne envie de regarder
- En français

Réponds UNIQUEMENT avec la caption, sans guillemets ni texte supplémentaire.`;

      const result = await this.generateWithFallback(prompt);
      return result.trim().replace(/^["']|["']$/g, '');

    } catch (error: any) {
      this.logger.error(`❌ Erreur génération caption: ${error.message}`);
      return originalCaption;
    }
  }

  /**
   * 🆕 Générer des hashtags OPTIMISÉS basés sur l'analyse vidéo
   */
  async generateHashtagsFromVideo(
    detectedContent?: string,
    detectedCategories?: string[],
    detectedDishes?: string[]
  ): Promise<string[]> {
    try {
      // Valeurs par défaut si undefined
      const content = detectedContent || 'Contenu culinaire';
      const categoriesText = detectedCategories && detectedCategories.length > 0 
        ? detectedCategories.join(', ') 
        : 'Aucune';
      const dishesText = detectedDishes && detectedDishes.length > 0 
        ? detectedDishes.join(', ') 
        : 'Aucun';

      const prompt = `Tu es un expert en hashtags viraux pour les réseaux sociaux culinaires (TikTok, Instagram, YouTube Shorts).

🎥 ANALYSE DE LA VIDÉO:
Contenu: ${content}
Catégories: ${categoriesText}
Plats: ${dishesText}

📝 MISSION: Génère 8-10 hashtags OPTIMISÉS pour maximiser la visibilité:

✅ STRATÉGIE DE HASHTAGS:
1. **2 hashtags MEGA populaires** (millions de vues)
   - Exemples: foodporn, foodie, cooking, recipe, yummy
   
2. **3 hashtags SPÉCIFIQUES au plat**
   - Basés sur les plats détectés
   - Exemples: carbonara, sushi, tiramisu, burger
   
3. **2 hashtags de CATÉGORIE**
   - Basés sur le type de contenu
   - Exemples: recette, restaurant, streetfood, dessert
   
4. **2-3 hashtags de NICHE** (engagement élevé)
   - Communautés actives mais pas saturées
   - Exemples: foodasmr, recettefacile, cuisinemaison

⚠️ RÈGLES:
- Mélange français/anglais (60% anglais, 40% français)
- TOUS en lowercase
- Entre 5 et 25 caractères
- Pas de caractères spéciaux sauf lettres
- SANS le symbole #

💡 EXEMPLES DE BONS HASHTAGS:
- foodporn, foodie, cooking, recipe, yummy (populaires)
- carbonara, pasta, italianfood (spécifiques)
- recette, cuisine, fait maison (français)
- foodasmr, cookinghacks, easyrecipe (niche)

Réponds UNIQUEMENT avec les hashtags, UN PAR LIGNE, sans numéros, sans tirets, sans # :`;

      const result = await this.generateWithFallback(prompt);
      
      const hashtags = result
        .split('\n')
        .map(line => line.trim()
          .replace(/^[0-9\-\.\*#\s]+/, '')
          .replace(/^#/, '')
          .toLowerCase())
        .filter(tag => 
          tag.length >= 3 && 
          tag.length <= 25 && 
          /^[a-z0-9]+$/.test(tag)
        )
        .slice(0, 10);

      // Fallback si pas assez de hashtags générés
      if (hashtags.length < 5) {
        return ['foodporn', 'foodie', 'cooking', 'recipe', 'yummy', 'delicious', 'cuisine', 'food'];
      }

      this.logger.log(`🏷️ Hashtags générés: ${hashtags.join(', ')}`);
      return hashtags;

    } catch (error: any) {
      this.logger.error(`❌ Erreur génération hashtags depuis vidéo: ${error.message}`);
      return ['foodporn', 'foodie', 'cooking', 'recipe', 'yummy', 'delicious', 'cuisine', 'food'];
    }
  }

  /**
   * Générer des hashtags pertinents (keep for backward compatibility)
   */
  async generateFoodHashtags(
    caption: string,
    categories: string[] = [],
    detectedDishes?: string[]
  ): Promise<string[]> {
    try {
      const categoriesText = categories.join(', ');
      const dishesText = detectedDishes ? detectedDishes.join(', ') : '';

      const prompt = `Génère 6 hashtags pertinents pour ce contenu culinaire:

Caption: "${caption}"
Catégories: ${categoriesText}
${dishesText ? `Plats: ${dishesText}` : ''}

Règles:
- Hashtags populaires et pertinents
- Mélange de génériques (#food) et spécifiques
- En français et anglais
- Sans le symbole #

Réponds avec UNE liste simple, un hashtag par ligne, sans numéros ni tirets:`;

      const result = await this.generateWithFallback(prompt);
      
      const hashtags = result
        .split('\n')
        .map(line => line.trim().replace(/^[0-9\-\.\*#\s]+/, '').replace(/^#/, ''))
        .filter(tag => tag.length > 2 && tag.length < 30 && /^[a-zA-Z0-9éèêàâçù]+$/.test(tag))
        .slice(0, 8);

      return hashtags.length > 0 ? hashtags : ['food', 'cuisine', 'delicious', 'foodporn'];

    } catch (error: any) {
      this.logger.error(`❌ Erreur génération hashtags: ${error.message}`);
      return ['food', 'cuisine', 'delicious', 'foodporn'];
    }
  }

  /**
   * Tester la connexion à l'API Gemini
   */
  async testConnection(): Promise<{ success: boolean; model?: string; error?: string }> {
    try {
      const result = await this.generateWithFallback('Réponds simplement "OK"');
      return { 
        success: true, 
        model: this.workingModel || 'unknown' 
      };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Lister tous les modèles disponibles (pour debug)
   */
  async getAvailableModels(): Promise<string[]> {
    return await this.listAvailableModels();
  }
}