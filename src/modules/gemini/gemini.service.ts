// src/modules/gemini/gemini.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    
    if (!this.apiKey) {
      this.logger.error('❌ GEMINI_API_KEY non configurée dans .env');
      this.logger.warn('Pour obtenir une clé: https://makersuite.google.com/app/apikey');
    } else if (this.apiKey === 'AIzaSyAk8opC7M_eFfSvKJ-d8U5BuBVakS36lBQ') {
      this.logger.error('❌ Clé API Gemini invalide (clé de démo)');
      this.logger.warn('Veuillez obtenir une vraie clé sur Google AI Studio');
    } else {
      this.logger.log(`✅ Clé API Gemini configurée (${this.apiKey.substring(0, 15)}...)`);
    }
  }

  /**
   * Vérifier si Gemini est disponible
   */
  async isGeminiAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    
    try {
      const response = await axios.get(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        { timeout: 5000 }
      );
      return response.status === 200;
    } catch (error) {
      this.logger.error(`❌ Gemini non disponible: ${error.message}`);
      return false;
    }
  }

  /**
   * Générer du contenu avec Gemini
   */
  async generateContent(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Clé API Gemini non configurée');
    }

    try {
      // Essayer d'abord gemini-pro (gratuit)
      const models = ['gemini-pro', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];
      
      for (const model of models) {
        try {
          const response = await axios.post(
            `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
            {
              contents: [{
                parts: [{ text: prompt }]
              }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1000,
              }
            },
            {
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000
            }
          );

          const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            this.logger.log(`✅ Gemini réponse avec ${model}`);
            return text;
          }
        } catch (modelError: any) {
          this.logger.debug(`Modèle ${model} échoué: ${modelError.response?.data?.error?.message || modelError.message}`);
          continue;
        }
      }
      
      throw new Error('Tous les modèles Gemini ont échoué');
      
    } catch (error: any) {
      this.logger.error(`Erreur Gemini: ${error.message}`);
      
      // Détails d'erreur spécifiques
      if (error.response?.data?.error) {
        const geminiError = error.response.data.error;
        this.logger.error(`Code: ${geminiError.code}, Message: ${geminiError.message}`);
        
        if (geminiError.status === 'PERMISSION_DENIED') {
          throw new Error('Clé API invalide ou non autorisée. Vérifiez votre clé sur Google AI Studio.');
        }
        if (geminiError.status === 'RESOURCE_EXHAUSTED') {
          throw new Error('Quota Gemini épuisé. Vérifiez votre facturation Google Cloud.');
        }
      }
      
      throw new Error(`Service Gemini indisponible: ${error.message}`);
    }
  }

  /**
   * Détecter si le contenu est lié à la nourriture
   */
  async detectFoodContent(caption: string, hashtags: string[] = [], categories: string[] = []): Promise<{
    isFood: boolean;
    confidence: number;
    dishName?: string;
    cuisine?: string;
  }> {
    if (!this.apiKey) {
      return {
        isFood: true,
        confidence: 50,
        dishName: 'Contenu non vérifié',
      };
    }

    const prompt = `Analyse rapide: Est-ce que ce contenu parle de nourriture/cuisine?
Caption: "${caption}"
Hashtags: ${hashtags.join(' ')}
Catégories: ${categories.join(' ')}

Réponds UNIQUEMENT en JSON: {
  "isFood": true/false,
  "confidence": 0-100,
  "dishName": "nom du plat si détecté",
  "cuisine": "type de cuisine si détecté"
}`;

    try {
      const result = await this.generateContent(prompt);
      
      // Parser le JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Réponse JSON invalide');
      
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.logger.warn(`Détection food échouée: ${error.message}`);
      return {
        isFood: true, // Par défaut accepté
        confidence: 50,
        dishName: 'Non détecté',
      };
    }
  }

  /**
   * Générer une caption améliorée
   */
  async generateImprovedCaption(originalCaption: string): Promise<string> {
    if (!this.apiKey) {
      return `${originalCaption} 🍽️✨`;
    }

    const prompt = `Améliore cette légende pour un reel culinaire sur TikTok/Instagram:
"${originalCaption}"

Règles:
- Garde 1-2 phrases maximum
- Ajoute 1-2 emojis pertinents (🍽️👨‍🍳✨🤤)
- Rends-la engageante
- Réponds avec la légende seulement, sans explication`;

    try {
      const result = await this.generateContent(prompt);
      return result.trim().replace(/["']/g, '') || `${originalCaption} 🍽️`;
    } catch (error) {
      return `${originalCaption} 🍽️✨`;
    }
  }

  /**
   * Générer des hashtags pertinents
   */
  async generateRelevantHashtags(caption: string, categories: string[] = []): Promise<string[]> {
    if (!this.apiKey) {
      return ['food', 'cuisine', 'delicious'];
    }

    const prompt = `Génère 5-8 hashtags pertinents pour ce contenu culinaire:
"${caption}"
Catégories: ${categories.join(', ')}

Règles:
- Hashtags en français/anglais
- Pertinents pour la nourriture
- Réponds UNIQUEMENT avec une liste, un par ligne`;

    try {
      const result = await this.generateContent(prompt);
      return result
        .split('\n')
        .map(line => line.trim().replace(/^#/, ''))
        .filter(tag => tag.length > 0 && tag.length < 30)
        .slice(0, 8);
    } catch (error) {
      return ['food', 'cuisine', 'delicious', 'yummy', 'foodie'];
    }
  }
}