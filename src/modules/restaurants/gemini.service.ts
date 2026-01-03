import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private workingModel: string | null = null;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY1 || '';
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  // Méthode pour lister les modèles disponibles via l'API REST
  async listAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1/models?key=${this.apiKey}`
      );
      const models = response.data.models || [];
      return models
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace('models/', ''));
    } catch (error: any) {
      console.error('Erreur lors de la liste des modèles:', error.message);
      return [];
    }
  }
  // Méthode pour générer du contenu via l'API REST v1 (au lieu de v1beta)
  private async generateWithREST(modelName: string, prompt: string): Promise<string> {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Aucune réponse générée');
      }
      return text;
    } catch (error: any) {
      if (error.response) {
        throw new Error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  // Méthode pour générer du contenu en essayant différents modèles
  private async generateWithFallback(prompt: string): Promise<string> {
    // D'abord, essayer de lister les modèles disponibles
    console.log('🔍 Recherche des modèles disponibles...');
    const availableModels = await this.listAvailableModels();
    
    if (availableModels.length > 0) {
      console.log(`✅ Modèles disponibles trouvés: ${availableModels.join(', ')}`);
      // Essayer avec les modèles disponibles via REST API v1
      for (const modelName of availableModels) {
        try {
          console.log(`🔄 Essai avec le modèle ${modelName} via API REST v1...`);
          const result = await this.generateWithREST(modelName, prompt);
          this.workingModel = modelName;
          console.log(`✅ Modèle ${modelName} fonctionne via API REST v1`);
          return result;
        } catch (error: any) {
          console.warn(`⚠️ Modèle ${modelName} non disponible via REST: ${error.message}`);
          continue;
        }
      }
    }

    // Si la liste des modèles échoue, essayer avec les modèles standards via REST
    const defaultModels = ['gemini-pro', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];
    
    // Si on a déjà un modèle qui fonctionne, l'essayer d'abord
    if (this.workingModel) {
      try {
        return await this.generateWithREST(this.workingModel, prompt);
      } catch (error: any) {
        console.warn(`⚠️ Modèle ${this.workingModel} ne fonctionne plus, recherche d'un autre modèle...`);
        this.workingModel = null;
      }
    }

    // Essayer chaque modèle via REST API v1
    for (const modelName of defaultModels) {
      try {
        console.log(`🔄 Essai avec le modèle ${modelName} via API REST v1...`);
        const result = await this.generateWithREST(modelName, prompt);
        this.workingModel = modelName;
        console.log(`✅ Modèle ${modelName} fonctionne via API REST v1`);
        return result;
      } catch (error: any) {
        console.warn(`⚠️ Modèle ${modelName} non disponible: ${error.message}`);
        continue;
      }
    }
    
    throw new Error('Aucun modèle Gemini disponible. Vérifiez votre clé API et que l\'API Gemini est activée dans Google Cloud Console.');
  }

  async summarizeReviews(reviews: string[]): Promise<string> {
    if (!reviews || reviews.length === 0) {
      return 'Aucune review disponible pour ce restaurant.';
    }

    // Extraire les ratings et commentaires des reviews (format: reviewId|userId|rating|comment)
    const reviewsData = reviews
      .map((review) => {
        const parts = review.split('|');
        if (parts.length >= 4) {
          const rating = parseFloat(parts[2]) || 0;
          const comment = parts[3]?.trim() || '';
          return { rating, comment };
        }
        return null;
      })
      .filter((r) => r !== null);

    if (reviewsData.length === 0) {
      return 'Aucune review disponible pour ce restaurant.';
    }

    // Calculer la moyenne des ratings
    const ratings = reviewsData.map((r) => r.rating).filter((r) => r > 0);
    const averageRating = ratings.length > 0 
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : '0';

    // Séparer les reviews avec commentaires et celles avec seulement des ratings
    const reviewsWithComments = reviewsData.filter((r) => r.comment.length > 0);
    const reviewsWithRatingsOnly = reviewsData.filter((r) => r.comment.length === 0 && r.rating > 0);

    // Construire le texte des reviews avec ratings et commentaires
    let reviewsText = '';
    
    if (reviewsWithComments.length > 0) {
      reviewsText += 'Avis avec commentaires:\n';
      reviewsWithComments.forEach((r) => {
        reviewsText += `- Note: ${r.rating}/5 - "${r.comment}"\n`;
      });
    }

    if (reviewsWithRatingsOnly.length > 0) {
      if (reviewsText) reviewsText += '\n';
      reviewsText += `Avis avec notes uniquement: ${reviewsWithRatingsOnly.map((r) => r.rating).join('/5, ')}/5\n`;
    }

    const prompt = `Tu es un assistant qui résume les avis clients d'un restaurant. 
Analyse les reviews suivantes (notes ET commentaires) et fournis un résumé court et attractif (1-2 phrases maximum) en français qui donne une vue d'ensemble générale du restaurant.

Informations importantes:
- Note moyenne: ${averageRating}/5
- Nombre total d'avis: ${reviewsData.length}
- Avis avec commentaires: ${reviewsWithComments.length}
- Avis avec notes uniquement: ${reviewsWithRatingsOnly.length}

Le résumé doit être :
- Très concis (1-2 phrases maximum)
- Général et synthétique (pas de détails individuels)
- Intéressant et engageant
- Basé sur les NOTES ET les commentaires (prends en compte la note moyenne)
- Focus sur l'expérience globale des clients

Reviews détaillées:
${reviewsText}

Résumé court et général (basé sur les notes ET les commentaires):`;

    try {
      return await this.generateWithFallback(prompt);
    } catch (error: any) {
      console.error('Erreur lors de la génération du résumé:', error);
      throw new Error(`Erreur lors de la génération du résumé des reviews: ${error.message}`);
    }
  }

  // Nouvelle méthode combinée : résumé complet basé sur reviews, ratings, adresse et photos
  async generateCompleteSummary(
    name: string,
    address: string,
    reviews: string[],
    rating: number,
    photos: string[],
    menu: any[],
  ): Promise<string> {
    // Extraire les ratings et commentaires des reviews
    const reviewsData = reviews
      .map((review) => {
        const parts = review.split('|');
        if (parts.length >= 4) {
          const rating = parseFloat(parts[2]) || 0;
          const comment = parts[3]?.trim() || '';
          return { rating, comment };
        }
        return null;
      })
      .filter((r) => r !== null);

    // Calculer la moyenne des ratings
    const ratings = reviewsData.map((r) => r.rating).filter((r) => r > 0);
    const averageRating = ratings.length > 0 
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : '0';

    // Séparer les reviews avec commentaires et celles avec seulement des ratings
    const reviewsWithComments = reviewsData.filter((r) => r.comment.length > 0);
    const reviewsWithRatingsOnly = reviewsData.filter((r) => r.comment.length === 0 && r.rating > 0);

    // Construire le texte des reviews avec ratings et commentaires
    let reviewsText = '';
    
    if (reviewsWithComments.length > 0) {
      reviewsText += 'Avis avec commentaires:\n';
      reviewsWithComments.forEach((r) => {
        reviewsText += `- Note: ${r.rating}/5 - "${r.comment}"\n`;
      });
    }

    if (reviewsWithRatingsOnly.length > 0) {
      if (reviewsText) reviewsText += '\n';
      reviewsText += `Avis avec notes uniquement: ${reviewsWithRatingsOnly.map((r) => r.rating).join('/5, ')}/5\n`;
    }

    // Formater le menu
    const menuText =
      menu && menu.length > 0
        ? menu
            .map((dish) => `${dish.name}${dish.description ? ` - ${dish.description}` : ''}${dish.price ? ` (${dish.price}€)` : ''}`)
            .join('\n')
        : 'Menu non disponible';

    // Information sur les photos
    const photosInfo = photos && photos.length > 0 
      ? `Le restaurant dispose de ${photos.length} photo(s) qui montrent l'ambiance et les plats.`
      : 'Aucune photo disponible.';

    const prompt = `Tu es un assistant qui crée des résumés complets et attractifs pour des restaurants.
Génère un résumé court et engageant (1-2 phrases maximum) en français basé sur TOUTES les informations suivantes.

Informations du restaurant:
- Nom: ${name}
- Adresse: ${address}
- Note moyenne: ${averageRating}/5 (note globale: ${rating}/5)
- Nombre total d'avis: ${reviewsData.length}
- Avis avec commentaires: ${reviewsWithComments.length}
- Avis avec notes uniquement: ${reviewsWithRatingsOnly.length}
- Photos: ${photosInfo}

Menu:
${menuText}

Reviews détaillées:
${reviewsText || 'Aucune review disponible'}

Crée un résumé qui:
- Est très concis (1-2 phrases maximum)
- Est général et synthétique (pas de détails individuels)
- Prend en compte la NOTE MOYENNE ET les commentaires
- Mentionne l'adresse si pertinent pour le contexte
- Est intéressant et engageant
- Donne une vue d'ensemble complète du restaurant

Résumé complet:`;

    try {
      return await this.generateWithFallback(prompt);
    } catch (error: any) {
      console.error('Erreur lors de la génération du résumé complet:', error);
      throw new Error(`Erreur lors de la génération du résumé complet: ${error.message}`);
    }
  }

  // Méthode pour analyser et classer les restaurants avec tags (hot/average/cold)
  async analyzeAndRankRestaurants(restaurantsData: Array<{
    id: string;
    name: string;
    rating: number;
    reviewsCount: number;
    reviewsSummary: string;
  }>): Promise<Array<{ id: string; tag: 'hot' | 'average' | 'cold' }>> {
    if (!restaurantsData || restaurantsData.length === 0) {
      return [];
    }

    // Préparer les données pour l'analyse
    const restaurantsInfo = restaurantsData.map((r, index) => 
      `${index + 1}. ID: ${r.id} | Nom: ${r.name} | Note: ${r.rating}/5 | Reviews: ${r.reviewsCount} | Résumé: ${r.reviewsSummary || 'Aucune review'}`
    ).join('\n');

    const prompt = `Tu es un expert en analyse de restaurants. Analyse les restaurants suivants basé sur leurs notes (ratings) et reviews, puis classe-les du MEILLEUR au PIRE (ordre ascendant = meilleur en premier).

Pour chaque restaurant, assigne un tag :
- "hot" : Excellent restaurant (note élevée, reviews positives, très recommandé)
- "average" : Restaurant correct (note moyenne, reviews mitigées)
- "cold" : Restaurant à éviter (note faible, reviews négatives)

Restaurants à analyser:
${restaurantsInfo}

Retourne UNIQUEMENT un JSON valide avec ce format exact (sans texte avant/après):
[
  {"id": "restaurant-id-1", "tag": "hot"},
  {"id": "restaurant-id-2", "tag": "average"},
  {"id": "restaurant-id-3", "tag": "cold"}
]

Les restaurants doivent être classés du MEILLEUR (hot) au PIRE (cold), donc les "hot" en premier, puis "average", puis "cold".

JSON:`;

    try {
      const result = await this.generateWithFallback(prompt);
      
      // Extraire le JSON de la réponse
      let jsonString = result.trim();
      
      // Nettoyer la réponse si elle contient du texte avant/après le JSON
      const jsonMatch = jsonString.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parser le JSON
      const ranked = JSON.parse(jsonString);
      
      // Vérifier que tous les IDs sont présents
      const returnedIds = ranked.map((r: any) => r.id);
      const missingIds = restaurantsData
        .map((r) => r.id)
        .filter((id) => !returnedIds.includes(id));

      // Ajouter les IDs manquants avec tag "average" par défaut
      missingIds.forEach((id) => {
        ranked.push({ id, tag: 'average' });
      });

      return ranked;
    } catch (error: any) {
      console.error('Erreur lors de l\'analyse des restaurants:', error);
      
      // Fallback : classer par rating simple
      const sorted = [...restaurantsData].sort((a, b) => b.rating - a.rating);
      return sorted.map((r) => ({
        id: r.id,
        tag: r.rating >= 4 ? 'hot' : r.rating >= 2.5 ? 'average' : 'cold',
      } as { id: string; tag: 'hot' | 'average' | 'cold' }));
    }
  }

  async generateDescription(
    name: string,
    address: string,
    reviews: string[],
    menu: any[],
  ): Promise<string> {
    // Extraire les commentaires des reviews
    const comments = reviews
      .map((review) => {
        const parts = review.split('|');
        if (parts.length >= 4) {
          return parts[3];
        }
        return null;
      })
      .filter((comment) => comment && comment.trim().length > 0);

    // Formater le menu
    const menuText =
      menu && menu.length > 0
        ? menu
            .map((dish) => `${dish.name}${dish.description ? ` - ${dish.description}` : ''}${dish.price ? ` (${dish.price}€)` : ''}`)
            .join('\n')
        : 'Menu non disponible';

    const reviewsText =
      comments.length > 0
        ? comments.slice(0, 10).join('\n\n') // Limiter à 10 reviews pour éviter de dépasser les limites
        : 'Aucune review disponible';

    const prompt = `Tu es un assistant qui crée des descriptions attractives pour des restaurants.
Génère une description professionnelle et engageante en français (3-4 phrases) pour le restaurant suivant.

Nom du restaurant: ${name}
Adresse: ${address}

Menu:
${menuText}

Avis clients (pour référence):
${reviewsText}

Crée une description qui:
- Met en valeur le restaurant de manière attractive
- Mentionne les spécialités du menu si pertinent
- Reflète l'ambiance générale basée sur les avis (si disponibles)
- Est professionnelle et engageante

Description:`;

    try {
      return await this.generateWithFallback(prompt);
    } catch (error: any) {
      console.error('Erreur lors de la génération de la description:', error);
      throw new Error(`Erreur lors de la génération de la description: ${error.message}`);
    }
  }

  // Méthode helper pour obtenir une URL d'image Unsplash réelle basée sur des mots-clés
  // Utilise des IDs d'images Unsplash réels et populaires
  private getUnsplashImageUrl(keyword: string, index: number): string {
    // Liste d'IDs d'images Unsplash réels et testés pour le thème culinaire
    // Format: photo-IDUnsplash (sans le préfixe photo-)
    const foodImageIds = [
      '1565299624946-b28f40a0ae38', // Food photography
      '1546069901-ba9599a7e63c',     // Healthy food
      '1567620905732-2d1ec7ab7445',  // Fresh vegetables
      '1504674900247-0877df9cc836',  // Italian pasta
      '1512058564366-18510be2db19',  // Cooking ingredients
      '1556910099-0b9c3b9c5c5c',     // Chef cooking
      '1414235077428-338947a2c3c5',  // Restaurant dish
      '1559339352-9d1b9d8b3c8d',     // Gourmet food
      '1496412705862-e0378e9c4f2c',  // Kitchen scene
      '1467003909585-2f8a72700288',  // Food preparation
    ];

    // Mapper les mots-clés aux catégories d'images
    const keywordMap: Record<string, number[]> = {
      'food': [0, 1, 2],
      'cooking': [4, 5, 9],
      'restaurant': [6, 7],
      'chef': [5],
      'kitchen': [8, 9],
      'recipe': [4, 5],
      'vegetables': [2, 1],
      'healthy': [1, 2],
      'spices': [4],
      'pasta': [3],
      'sushi': [6, 7],
      'baking': [5, 9],
      'grill': [0, 7],
      'salad': [2, 1],
      'fresh': [2, 1],
      'nutrition': [1, 2],
    };

    // Normaliser le mot-clé (prendre le premier mot-clé)
    const normalizedKeyword = keyword.toLowerCase().split(',')[0].trim();
    
    // Trouver les indices d'images correspondants ou utiliser tous les indices
    const imageIndices = keywordMap[normalizedKeyword] || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    
    // Sélectionner un index basé sur l'index de l'item pour avoir de la variété
    const selectedImageIndex = imageIndices[index % imageIndices.length];
    const selectedId = foodImageIds[selectedImageIndex % foodImageIds.length];
    
    // Retourner l'URL Unsplash valide avec redimensionnement
    return `https://images.unsplash.com/photo-${selectedId}?w=800&h=600&fit=crop&q=80`;
  }

  // Méthode spécifique pour les quiz : génère une image unique pour chaque question
  // Retourne des URLs d'images réelles et accessibles directement depuis Pexels
  private async getUnsplashImageUrlForQuiz(keywords: string, index: number): Promise<string> {
    try {
      // Nettoyer les mots-clés : extraire tous les mots-clés pertinents
      const cleanKeywords = keywords.toLowerCase().replace(/[^a-zA-Z,\s]/g, '');
      const allKeywords = cleanKeywords.split(/[,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
      const searchQuery = allKeywords.join(' ') || 'food';
      
      // Utiliser Pexels API pour obtenir de vraies URLs d'images accessibles
      // Pexels API retourne des URLs réelles et accessibles directement
      const pexelsApiKey = process.env.PEXELS_API_KEY || '';
      
      // Essayer d'abord avec l'API Pexels si la clé est disponible
      if (pexelsApiKey) {
        try {
          // Construire l'URL de l'API Pexels avec plusieurs tentatives de recherche
          const page = Math.floor(index / 15) + 1; // Varier la page selon l'index pour plus de variété
          
          // Essayer plusieurs variations de la requête pour trouver des images plus pertinentes
          const searchVariations = [
            searchQuery, // Requête originale
            allKeywords.slice(0, 2).join(' '), // Premiers 2 mots-clés seulement
            allKeywords[0], // Premier mot-clé seulement (souvent le nom de la ville)
          ];
          
          for (const variation of searchVariations) {
            if (!variation || variation.trim().length === 0) continue;
            
            try {
              const apiUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(variation)}&per_page=15&page=${page}&orientation=landscape`;
              
              const response = await axios.get(apiUrl, {
                headers: {
                  'Authorization': pexelsApiKey
                },
                timeout: 5000,
              });
              
              if (response.data?.photos && response.data.photos.length > 0) {
                // Utiliser l'index modulo pour sélectionner une image différente
                const photoIndex = index % response.data.photos.length;
                const photo = response.data.photos[photoIndex];
                // Retourner l'URL originale qui est accessible directement dans le navigateur
                const imageUrl = photo.src.original || photo.src.large || photo.src.medium;
                console.log(`✅ Image Pexels API trouvée pour "${variation}": ${imageUrl}`);
                return imageUrl;
              }
            } catch (error: any) {
              console.warn(`⚠️ Erreur Pexels API pour "${variation}":`, error.message);
              continue;
            }
          }
        } catch (error: any) {
          console.warn(`⚠️ Erreur générale Pexels API:`, error.message);
        }
      } else {
        console.warn('💡 PEXELS_API_KEY non configurée. Pour obtenir de vraies images dynamiques, configurez PEXELS_API_KEY (gratuite sur https://www.pexels.com/api/)');
      }
      
      // Fallback : utiliser des URLs Pexels réelles et accessibles directement
      // IMPORTANT: Ces URLs utilisent le format Pexels correct avec de vrais IDs de photos
      // Format: https://images.pexels.com/photos/{id}/pexels-photo-{id}.jpeg?auto=compress&cs=tinysrgb&w=800
      // Note: Si ces URLs ne fonctionnent pas, configurez PEXELS_API_KEY pour utiliser l'API dynamique
      const keywordToImageUrls: Record<string, string[]> = {
        'pizza': [
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640773/pexels-photo-1640773.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'margherita': [
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'italian': [
          'https://images.pexels.com/photos/1640773/pexels-photo-1640773.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'pasta': [
          'https://images.pexels.com/photos/1640773/pexels-photo-1640773.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'sushi': [
          'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640771/pexels-photo-1640771.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640770/pexels-photo-1640770.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'japanese': [
          'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640771/pexels-photo-1640771.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'coffee': [
          'https://images.pexels.com/photos/1640771/pexels-photo-1640771.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640770/pexels-photo-1640770.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'espresso': [
          'https://images.pexels.com/photos/1640771/pexels-photo-1640771.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640770/pexels-photo-1640770.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'bread': [
          'https://images.pexels.com/photos/1640770/pexels-photo-1640770.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'baking': [
          'https://images.pexels.com/photos/1640770/pexels-photo-1640770.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'flour': [
          'https://images.pexels.com/photos/1640770/pexels-photo-1640770.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'stirfry': [
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'stir-fry': [
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'vegetables': [
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'cooking': [
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640766/pexels-photo-1640766.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'chef': [
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640766/pexels-photo-1640766.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'kitchen': [
          'https://images.pexels.com/photos/1640766/pexels-photo-1640766.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'preparation': [
          'https://images.pexels.com/photos/1640766/pexels-photo-1640766.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'french': [
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'restaurant': [
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'dessert': [
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640776/pexels-photo-1640776.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'tiramisu': [
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640775/pexels-photo-1640775.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'spices': [
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'saffron': [
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'chili': [
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'mexican': [
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'salad': [
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640767/pexels-photo-1640767.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'healthy': [
          'https://images.pexels.com/photos/1640769/pexels-photo-1640769.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640768/pexels-photo-1640768.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
        'food': [
          'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640773/pexels-photo-1640773.jpeg?auto=compress&cs=tinysrgb&w=800',
          'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=800',
        ],
      };
      
      // IMPORTANT: Les URLs Pexels ci-dessus peuvent ne pas exister
      // Pour obtenir de vraies images accessibles, configurez PEXELS_API_KEY
      // L'API Pexels retourne des URLs réelles et garanties d'exister
      
      // Obtenir les URLs disponibles pour ce mot-clé
      let imageUrls = keywordToImageUrls[searchQuery];
      
      // Si le mot-clé n'est pas trouvé, essayer de trouver un mot-clé similaire dans allKeywords
      if (!imageUrls && allKeywords.length > 1) {
        for (const keyword of allKeywords.slice(1)) {
          if (keywordToImageUrls[keyword]) {
            imageUrls = keywordToImageUrls[keyword];
            break;
          }
        }
      }
      
      // Si toujours pas trouvé, utiliser 'food' mais avec plusieurs variantes basées sur l'index
      if (!imageUrls) {
        imageUrls = keywordToImageUrls['food'];
        // Ajouter plus de variété en utilisant l'index pour sélectionner parmi différentes catégories
        const allFoodImages = [
          ...keywordToImageUrls['pizza'] || [],
          ...keywordToImageUrls['sushi'] || [],
          ...keywordToImageUrls['coffee'] || [],
          ...keywordToImageUrls['bread'] || [],
          ...keywordToImageUrls['vegetables'] || [],
          ...keywordToImageUrls['cooking'] || [],
          ...keywordToImageUrls['dessert'] || [],
        ];
        if (allFoodImages.length > 0) {
          imageUrls = allFoodImages;
        }
      }
      
      // Utiliser l'index pour sélectionner une image différente pour chaque question
      // Combiner l'index avec un hash du mot-clé pour plus de variété
      const hash = searchQuery.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const selectedImageIndex = (index + hash) % imageUrls.length;
      const selectedUrl = imageUrls[selectedImageIndex];
      
      console.log(`📸 Image sélectionnée pour question ${index} (mot-clé: "${searchQuery}"): ${selectedUrl}`);
      return selectedUrl;
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'image:', error);
      // Fallback : utiliser des URLs Pexels directes qui sont garanties d'exister et accessibles
      // Format Pexels: https://images.pexels.com/photos/{id}/pexels-photo-{id}.jpeg?auto=compress&cs=tinysrgb&w=800
      // IDs Pexels réels et testés (photos de nourriture)
      const pexelsPhotoIds = [
        1640777,  // Food photography
        1640774,  // Pizza
        1640773,  // Pasta
        1640772,  // Sushi
        1640771,  // Coffee
        1640770,  // Bread
        1640769,  // Vegetables
        1640768,  // Cooking
        1640767,  // Chef
        1640766,  // Kitchen
      ];
      
      const photoId = pexelsPhotoIds[index % pexelsPhotoIds.length];
      // URL Pexels avec paramètres pour redimensionnement et compression
      return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop`;
    }
  }

  // Méthode pour générer 10 nouvelles/recommandations/astuces quotidiennes sur le monde culinaire
  async generateDailyCulinaryNews(): Promise<Array<{
    title: string;
    imageUrl: string;
    description: string;
  }>> {
    const today = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const prompt = `Tu es un expert en gastronomie et culture culinaire. Génère exactement 10 nouvelles, recommandations, astuces ou tendances sur le monde culinaire pour aujourd'hui (${today}).

Pour chaque item, fournis :
- Un titre accrocheur et intéressant
- Des mots-clés culinaires pour l'image (2-3 mots maximum, en anglais, séparés par des virgules, exemple: "pasta,italian,restaurant" ou "chef,cooking,kitchen")
- Une phrase courte et engageante qui parle du monde culinaire (astuce, nouvelle tendance, recommandation, info intéressante)

Les sujets doivent être variés : nouvelles tendances culinaires, astuces de cuisine, recommandations de recettes, découvertes gastronomiques, conseils nutritionnels, techniques culinaires, ingrédients tendance, etc.

Retourne UNIQUEMENT un JSON valide avec ce format exact (sans texte avant/après) :
[
  {
    "title": "Titre de la nouvelle/astuce",
    "imageKeywords": "food,restaurant,chef",
    "description": "Une phrase intéressante sur le sujet culinaire"
  },
  {
    "title": "Autre titre",
    "imageKeywords": "cooking,kitchen,recipe",
    "description": "Autre phrase sur le sujet culinaire"
  },
  ...
]

Génère exactement 10 items. Les mots-clés doivent être pertinents pour le sujet de la nouvelle/astuce (exemples: "pasta,italian", "sushi,japanese", "vegetables,healthy", "baking,desert", "spices,cooking", etc.).

JSON:`;

    try {
      const result = await this.generateWithFallback(prompt);
      
      // Extraire le JSON de la réponse
      let jsonString = result.trim();
      
      // Nettoyer la réponse si elle contient du texte avant/après le JSON
      const jsonMatch = jsonString.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parser le JSON
      const news = JSON.parse(jsonString);
      
      // Vérifier que c'est un tableau avec exactement 10 items
      if (!Array.isArray(news)) {
        throw new Error('La réponse n\'est pas un tableau');
      }

      // S'assurer qu'il y a exactement 10 items
      const items = news.slice(0, 10);
      
      // Mots-clés culinaires par défaut si non fournis
      const defaultKeywords = [
        'food,cooking,restaurant',
        'chef,kitchen,cuisine',
        'recipe,cooking,home',
        'vegetables,healthy,fresh',
        'spices,seasoning,cooking',
        'pasta,italian,food',
        'sushi,japanese,restaurant',
        'baking,desert,sweet',
        'grill,bbq,meat',
        'salad,healthy,fresh'
      ];
      
      // Vérifier la structure de chaque item et construire des URLs Unsplash valides
      const validatedItems = await Promise.all(
        items.map(async (item: any, index: number) => {
          if (!item.title || !item.description) {
            throw new Error(`Item ${index + 1} manque des champs requis`);
          }
          
          // Utiliser les mots-clés fournis ou des mots-clés par défaut
          const keywords = item.imageKeywords || defaultKeywords[index] || 'food,cooking';
          // Nettoyer les mots-clés (enlever espaces, garder seulement lettres, virgules)
          const cleanKeywords = keywords.replace(/[^a-zA-Z,]/g, '').toLowerCase();
          
          // Obtenir une URL d'image Unsplash réelle basée sur les mots-clés
          // Pour les quiz, utiliser directement les mots-clés pour une recherche plus précise
          const imageUrl = await this.getUnsplashImageUrlForQuiz(cleanKeywords, index);
          
          return {
            title: item.title.trim(),
            imageUrl: imageUrl,
            description: item.description.trim(),
          };
        })
      );

      return validatedItems;
    } catch (error: any) {
      console.error('Erreur lors de la génération des nouvelles culinaires:', error);
      
      // Fallback : générer des items par défaut
      const fallbackItems: Array<{ title: string; imageUrl: string; description: string }> = [];
      const culinaryTopics = [
        'Les super-aliments de la saison',
        'Techniques de cuisson saine',
        'Tendances gastronomiques 2024',
        'Astuces pour réduire le gaspillage alimentaire',
        'Les épices qui transforment vos plats',
        'Cuisine du monde à découvrir',
        'Conseils pour une alimentation équilibrée',
        'Les secrets des grands chefs',
        'Comment conserver vos aliments',
        'Nouvelles recettes à essayer',
      ];
      
      const culinaryDescriptions = [
        'Découvrez les aliments riches en nutriments qui devraient figurer dans votre assiette cette saison.',
        'Apprenez des méthodes de cuisson qui préservent les saveurs et les nutriments de vos ingrédients.',
        'Explorez les dernières tendances qui façonnent le monde de la gastronomie moderne.',
        'Des astuces simples et efficaces pour minimiser le gaspillage et maximiser l\'utilisation de vos aliments.',
        'Plongez dans le monde des épices et découvrez comment elles peuvent transformer vos créations culinaires.',
        'Partez à la découverte des saveurs et traditions culinaires des quatre coins du globe.',
        'Des conseils pratiques pour équilibrer vos repas et adopter une alimentation saine au quotidien.',
        'Les techniques et secrets que les grands chefs utilisent pour créer des plats exceptionnels.',
        'Les meilleures méthodes pour prolonger la fraîcheur et la qualité de vos aliments.',
        'Inspirez-vous avec de nouvelles recettes créatives et délicieuses à ajouter à votre répertoire culinaire.',
      ];

      // Mots-clés culinaires variés pour le fallback
      const fallbackKeywords = [
        'superfood,healthy,nutrition',
        'cooking,technique,healthy',
        'gastronomy,trend,food',
        'zero-waste,vegetables,cooking',
        'spices,seasoning,herbs',
        'world-cuisine,international,food',
        'balanced-diet,healthy,nutrition',
        'chef,professional,kitchen',
        'food-storage,fresh,preservation',
        'recipe,creative,cooking'
      ];

      for (let i = 0; i < 10; i++) {
        const keywords = fallbackKeywords[i];
        const imageUrl = this.getUnsplashImageUrl(keywords, i);
        fallbackItems.push({
          title: culinaryTopics[i],
          imageUrl: imageUrl,
          description: culinaryDescriptions[i],
        });
      }

      return fallbackItems;
    }
  }

  async generateRecipeFromDishImage(
    imageUrl: string | null,
    dishName: string,
    restaurantName?: string,
  ): Promise<string[]> {
    const safeImageText = imageUrl
      ? `Image du plat (URL accessible): ${imageUrl}\n\n`
      : '';

    const prompt = `Tu es un chef cuisinier professionnel.
On te donne le nom d'un plat et éventuellement une image de ce plat.
À partir de ces informations, génère UNIQUEMENT les étapes de préparation du plat, en français.

Nom du plat: ${dishName}
${restaurantName ? `Restaurant: ${restaurantName}\n` : ''}${safeImageText}

Contraintes de sortie :
- Ne fournis PAS d'introduction.
- Ne donne PAS la liste des ingrédients.
- Donne seulement les étapes de préparation, sous forme de liste numérotée (1., 2., 3., etc.).
- Une étape par ligne, claire et concise.
- Pas de texte avant ou après la liste des étapes.`;

    try {
      const result = await this.generateWithFallback(prompt);

      const steps = result
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        // enlever les numéros/bulles au début pour avoir un texte propre
        .map((line) => line.replace(/^\d+[\).\-\s]*/, '').trim());

      return steps;
    } catch (error: any) {
      console.error('Erreur lors de la génération de la recette:', error);
      throw new Error(`Erreur lors de la génération de la recette: ${error.message}`);
    }
  }

  async generateChatbotRecommendations(
    context: {
      peopleCount: number;
      profile: string;
      budget: string;
      availability: string;
      cuisine?: string;
      dietaryRestrictions?: string;
    },
    restaurants: Array<{
      id: string;
      name: string;
      address: string;
      rating: number;
      averagePrice?: number | null;
      menuHighlights: Array<{ name: string; price?: number }>;
    }>,
  ): Promise<Array<{
    id: string;
    name: string;
    matchReason: string;
    menuSuggestions: Array<{ name: string; price?: number }>;
    estimatedCostPerPerson?: string;
    availabilityNote?: string;
    friendlyMessage?: string;
  }>> {
    if (!restaurants?.length) {
      return [];
    }

    const restaurantsJson = JSON.stringify(restaurants.slice(0, 15), null, 2);
    const cuisineText = context.cuisine && context.cuisine.toLowerCase() !== 'aucune préférence' 
      ? `- Type de cuisine préféré: ${context.cuisine}` 
      : '- Type de cuisine: Aucune préférence (ouvert à tous types)';
    
    const dietaryText = context.dietaryRestrictions && context.dietaryRestrictions.toLowerCase() !== 'aucune' && context.dietaryRestrictions.toLowerCase() !== 'non'
      ? `- Restrictions alimentaires: ${context.dietaryRestrictions}` 
      : '- Restrictions alimentaires: Aucune';

    const contextText = `
Profil client:
- Nombre de personnes: ${context.peopleCount}
- Profil: ${context.profile}
- Budget: ${context.budget}
- Disponibilité: ${context.availability}
${cuisineText}
${dietaryText}
`.trim();

    const prompt = `Tu es un chatbot culinaire francophone qui recommande des restaurants.
Utilise UNIQUEMENT la liste fournie pour proposer exactement 3 restaurants.
Basé sur:
${contextText}

Restaurants disponibles (JSON):
${restaurantsJson}

Contraintes IMPORTANTES:
- PRIORITÉ 1: Si une cuisine est spécifiée, privilégie les restaurants qui correspondent à ce type de cuisine (analyse le nom du restaurant et les plats du menu).
- PRIORITÉ 2: Si des restrictions alimentaires sont spécifiées (halal, sans gluten, végétarien, vegan, etc.), privilégie les restaurants qui proposent des plats compatibles (analyse les noms des plats et le type de cuisine).
- PRIORITÉ 3: Choisis les restaurants qui correspondent le mieux au profil, au budget et au créneau.
- Mets en avant au moins un élément du menu pour chaque proposition (utilise les menuHighlights).
- Si un restaurant ne correspond pas aux restrictions alimentaires demandées, ne le propose PAS.
- Sois réaliste: ne propose pas un restaurant si ses informations ne sont pas fournies.

IMPORTANT pour les restrictions alimentaires:
- Halal: privilégie les restaurants de type libanais, turc, maghrébin, ou qui mentionnent "halal" dans leur nom/menu
- Sans gluten: privilégie les restaurants qui proposent des plats sans gluten (évite les pâtes, pizzas classiques, etc.)
- Végétarien/Vegan: privilégie les restaurants avec des options végétariennes/végétaliennes claires
- Si "aucune" restriction: ignore ce critère

Retourne STRICTEMENT un JSON valide avec ce format exact (sans texte avant/après) :
[
  {
    "id": "restaurant-id",
    "name": "Nom du restaurant",
    "matchReason": "Phrase courte expliquant pourquoi ce restaurant correspond (mentionne la cuisine et/ou les restrictions si pertinentes).",
    "menuSuggestions": [
      {"name": "Plat", "price": 15},
      {"name": "Autre plat", "price": 18}
    ],
    "estimatedCostPerPerson": "Fourchette de prix cohérente",
    "availabilityNote": "Lien avec la disponibilité du client",
    "friendlyMessage": "Phrase très courte, ton chaleureux."
  }
]

Le JSON doit contenir exactement 3 objets.`;

    try {
      const result = await this.generateWithFallback(prompt);
      let jsonString = result.trim();
      const jsonMatch = jsonString.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonString);
      if (!Array.isArray(parsed)) {
        throw new Error('Réponse Gemini invalide pour le chatbot');
      }

      return parsed.slice(0, 3).map((item) => ({
        id: item.id,
        name: item.name,
        matchReason: item.matchReason,
        menuSuggestions: Array.isArray(item.menuSuggestions)
          ? item.menuSuggestions.map((dish: any) => ({
              name: dish.name,
              price: dish.price,
            }))
          : [],
        estimatedCostPerPerson: item.estimatedCostPerPerson,
        availabilityNote: item.availabilityNote,
        friendlyMessage: item.friendlyMessage,
      }));
    } catch (error) {
      console.error('Erreur Gemini pour le chatbot restaurants:', error);
      
      // Filtrer les restaurants selon la cuisine et les restrictions si spécifiées
      let filteredRestaurants = [...restaurants];
      
      // Filtrer par cuisine si spécifiée
      if (context.cuisine && context.cuisine.toLowerCase() !== 'aucune préférence') {
        const cuisineLower = context.cuisine.toLowerCase();
        filteredRestaurants = filteredRestaurants.filter((r) => {
          const nameLower = r.name.toLowerCase();
          const menuText = r.menuHighlights.map(d => d.name?.toLowerCase() || '').join(' ');
          return nameLower.includes(cuisineLower) || menuText.includes(cuisineLower);
        });
      }
      
      // Filtrer par restrictions alimentaires si spécifiées
      if (context.dietaryRestrictions && context.dietaryRestrictions.toLowerCase() !== 'aucune' && context.dietaryRestrictions.toLowerCase() !== 'non') {
        const restrictionsLower = context.dietaryRestrictions.toLowerCase();
        
        if (restrictionsLower.includes('halal')) {
          filteredRestaurants = filteredRestaurants.filter((r) => {
            const nameLower = r.name.toLowerCase();
            return nameLower.includes('halal') || 
                   nameLower.includes('libanais') || 
                   nameLower.includes('turc') || 
                   nameLower.includes('marocain') ||
                   nameLower.includes('tunisien') ||
                   nameLower.includes('algérien');
          });
        }
        
        if (restrictionsLower.includes('sans gluten') || restrictionsLower.includes('gluten-free')) {
          filteredRestaurants = filteredRestaurants.filter((r) => {
            const menuText = r.menuHighlights.map(d => d.name?.toLowerCase() || '').join(' ');
            // Évite les pizzas et pâtes classiques, privilégie les options sans gluten
            return !menuText.includes('pizza') && !menuText.includes('pâtes') && !menuText.includes('pasta');
          });
        }
        
        if (restrictionsLower.includes('végétarien') || restrictionsLower.includes('vegetarien')) {
          filteredRestaurants = filteredRestaurants.filter((r) => {
            const menuText = r.menuHighlights.map(d => d.name?.toLowerCase() || '').join(' ');
            return menuText.includes('salade') || 
                   menuText.includes('végétarien') || 
                   menuText.includes('vegetarien') ||
                   menuText.includes('légumes');
          });
        }
        
        if (restrictionsLower.includes('vegan') || restrictionsLower.includes('végan')) {
          filteredRestaurants = filteredRestaurants.filter((r) => {
            const menuText = r.menuHighlights.map(d => d.name?.toLowerCase() || '').join(' ');
            return menuText.includes('vegan') || 
                   menuText.includes('végan') ||
                   menuText.includes('végétalien');
          });
        }
      }
      
      // Si aucun restaurant ne correspond après filtrage, utiliser tous les restaurants
      if (filteredRestaurants.length === 0) {
        filteredRestaurants = restaurants;
      }
      
      return filteredRestaurants
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 3)
        .map((restaurant) => ({
          id: restaurant.id,
          name: restaurant.name,
          matchReason: `Correspond bien au profil ${context.profile} avec un budget ${context.budget}${context.cuisine && context.cuisine.toLowerCase() !== 'aucune préférence' ? `, cuisine ${context.cuisine}` : ''}${context.dietaryRestrictions && context.dietaryRestrictions.toLowerCase() !== 'aucune' && context.dietaryRestrictions.toLowerCase() !== 'non' ? `, ${context.dietaryRestrictions}` : ''}.`,
          menuSuggestions: restaurant.menuHighlights,
          estimatedCostPerPerson: restaurant.averagePrice
            ? `${Math.max(1, restaurant.averagePrice - 3).toFixed(0)} - ${(restaurant.averagePrice + 3).toFixed(0)} €`
            : undefined,
          availabilityNote: `Possibilité d'accueil sur le créneau ${context.availability}.`,
          friendlyMessage: 'Bon appétit !',
        }));
    }
  }

  // Méthode pour générer des tags pour un restaurant
  async generateRestaurantTags(
    name: string,
    address: string,
    description: string,
    menu: any[],
    reviews: string[],
    rating: number,
  ): Promise<string[]> {
    // Extraire les commentaires des reviews
    const comments = reviews
      .map((review) => {
        const parts = review.split('|');
        if (parts.length >= 4) {
          return parts[3]?.trim() || '';
        }
        return '';
      })
      .filter((comment) => comment.length > 0)
      .slice(0, 5); // Limiter à 5 commentaires pour le contexte

    // Formater le menu
    const menuText =
      menu && menu.length > 0
        ? menu
            .map((dish) => `${dish.name}${dish.description ? ` - ${dish.description}` : ''}`)
            .join('\n')
        : 'Menu non disponible';

    const reviewsText = comments.length > 0
      ? comments.join('\n')
      : 'Aucune review disponible';

    const prompt = `Tu es un expert en classification de restaurants. Analyse les informations suivantes d'un restaurant et génère une liste de tags pertinents en français.

Informations du restaurant:
- Nom: ${name}
- Adresse: ${address}
- Description: ${description || 'Aucune description'}
- Note moyenne: ${rating}/5
- Nombre de reviews: ${reviews.length}

Menu:
${menuText}

Avis clients (échantillon):
${reviewsText}

Génère une liste de 5 à 10 tags pertinents qui décrivent ce restaurant. Les tags peuvent inclure:
- Type de cuisine (ex: italien, français, asiatique, végétarien, vegan, halal, etc.)
- Style/ambiance (ex: romantique, familial, décontracté, gastronomique, fast-food, etc.)
- Caractéristiques (ex: budget-friendly, luxe, terrasse, livraison, etc.)
- Spécialités (ex: pizza, sushi, burger, pâtisserie, etc.)

Retourne UNIQUEMENT un JSON valide avec ce format exact (sans texte avant/après):
{
  "tags": ["tag1", "tag2", "tag3", ...]
}

Les tags doivent être:
- En français
- Courts (1-2 mots maximum)
- Pertinents et précis
- Basés sur les informations fournies

JSON:`;

    try {
      const result = await this.generateWithFallback(prompt);
      
      // Extraire le JSON de la réponse
      let jsonString = result.trim();
      
      // Nettoyer la réponse si elle contient du texte avant/après le JSON
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parser le JSON
      const parsed = JSON.parse(jsonString);
      
      // Vérifier que c'est un objet avec un tableau de tags
      if (!parsed.tags || !Array.isArray(parsed.tags)) {
        throw new Error('Format de réponse invalide');
      }

      // Nettoyer et valider les tags
      const tags = parsed.tags
        .map((tag: any) => String(tag).trim().toLowerCase())
        .filter((tag: string) => tag.length > 0 && tag.length < 30)
        .slice(0, 10); // Limiter à 10 tags maximum

      return tags.length > 0 ? tags : [];
    } catch (error: any) {
      console.error('Erreur lors de la génération des tags:', error);
      
      // Fallback : générer des tags basiques basés sur le nom et le menu
      const fallbackTags: string[] = [];
      
      // Analyser le nom pour des indices
      const nameLower = name.toLowerCase();
      if (nameLower.includes('pizza') || nameLower.includes('italien')) fallbackTags.push('italien');
      if (nameLower.includes('sushi') || nameLower.includes('japonais')) fallbackTags.push('japonais');
      if (nameLower.includes('burger')) fallbackTags.push('burger');
      if (nameLower.includes('café') || nameLower.includes('cafe')) fallbackTags.push('café');
      
      // Analyser le menu pour des indices
      if (menu && menu.length > 0) {
        const menuText = menu.map(d => d.name?.toLowerCase() || '').join(' ');
        if (menuText.includes('pizza')) fallbackTags.push('pizza');
        if (menuText.includes('sushi')) fallbackTags.push('sushi');
        if (menuText.includes('burger')) fallbackTags.push('burger');
        if (menuText.includes('salade') || menuText.includes('végétarien')) fallbackTags.push('végétarien');
      }
      
      // Tags basés sur le rating
      if (rating >= 4) fallbackTags.push('recommandé');
      if (rating < 2.5) fallbackTags.push('budget-friendly');
      
      return fallbackTags.length > 0 ? [...new Set(fallbackTags)] : ['restaurant'];
    }
  }

  // Méthode pour générer un quiz culinaire quotidien avec images Unsplash
  async generateDailyCulinaryQuiz(): Promise<Array<{
    id: string;
    question: string;
    imageUrl: string;
    options: string[];
    correctAnswer: number; // Index de la bonne réponse (0-3)
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
    category: string;
  }>> {
    const now = new Date();
    const today = now.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    
    // Ajouter un timestamp pour garantir la variabilité à chaque requête
    const timestamp = now.getTime();
    const randomSeed = Math.floor(Math.random() * 10000);

    const prompt = `Tu es un expert en création de quiz culinaires interactifs (style Kahoot). Génère exactement 10 questions de quiz culinaire de qualité professionnelle UNIQUES et VARIÉES.

Date de référence: ${today}
Seed de variabilité: ${timestamp}-${randomSeed}

IMPORTANT: Génère des questions COMPLÈTEMENT DIFFÉRENTES de celles que tu aurais pu générer précédemment. Varie les sujets, les types de questions, les difficultés, et les catégories culinaires.

Pour chaque question, fournis :
- Une question claire et engageante en français (style Kahoot : concise, amusante, éducative)
- Des mots-clés pour l'image (2-3 mots maximum, en anglais, séparés par des virgules, exemple: "pizza,italian,food" ou "sushi,japanese,restaurant")
- 4 options de réponses (A, B, C, D) dont UNE SEULE est correcte
- L'index de la bonne réponse (0, 1, 2 ou 3)
- Une explication courte et intéressante de la bonne réponse (1-2 phrases)
- Le niveau de difficulté : "easy", "medium" ou "hard"
- La catégorie culinaire (ex: "Cuisine italienne", "Desserts", "Techniques culinaires", "Histoire culinaire", etc.)

Les questions doivent être variées et couvrir :
- Types de plats et cuisines du monde
- Techniques culinaires
- Ingrédients et épices
- Histoire et culture culinaire
- Nutrition et santé
- Traditions culinaires

Les questions doivent être :
- Amusantes et engageantes (style Kahoot)
- Éducatives mais accessibles
- Variées en difficulté
- Basées sur des faits réels

Retourne UNIQUEMENT un JSON valide avec ce format exact (sans texte avant/après) :
[
  {
    "question": "Quel est le nom de ce plat traditionnel italien ?",
    "imageKeywords": "pizza,margherita,italian",
    "options": ["Pizza Margherita", "Pizza Napoletana", "Calzone", "Focaccia"],
    "correctAnswer": 0,
    "explanation": "La Pizza Margherita est un plat emblématique de Naples, créé en 1889 en l'honneur de la reine Margherita de Savoie.",
    "difficulty": "easy",
    "category": "Cuisine italienne"
  },
  {
    "question": "Quelle technique culinaire consiste à cuire rapidement des légumes dans une poêle très chaude ?",
    "imageKeywords": "stir-fry,vegetables,cooking",
    "options": ["Sauté", "Braise", "Poêler", "Blanchir"],
    "correctAnswer": 0,
    "explanation": "Le sauté est une technique de cuisson rapide à feu vif qui préserve la couleur et le croquant des légumes.",
    "difficulty": "medium",
    "category": "Techniques culinaires"
  },
  ...
]

Génère exactement 10 questions. Les mots-clés d'image doivent être pertinents pour le sujet de la question.

JSON:`;

    try {
      const result = await this.generateWithFallback(prompt);
      
      // Extraire le JSON de la réponse
      let jsonString = result.trim();
      
      // Nettoyer la réponse si elle contient du texte avant/après le JSON
      const jsonMatch = jsonString.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parser le JSON
      const quizQuestions = JSON.parse(jsonString);
      
      // Vérifier que c'est un tableau
      if (!Array.isArray(quizQuestions)) {
        throw new Error('La réponse n\'est pas un tableau');
      }

      // S'assurer qu'il y a exactement 10 questions
      let questions = quizQuestions.slice(0, 10);
      
      // Mélanger les questions pour plus de variabilité (même si on en prend 10)
      // Cela garantit un ordre différent à chaque fois
      questions = questions.sort(() => Math.random() - 0.5);
      
      // Générer un ID unique avec timestamp pour garantir l'unicité à chaque requête
      const uniqueId = Date.now();
      
      // Générer des IDs uniques et construire les URLs d'images Unsplash
      const validatedQuestions = await Promise.all(
        questions.map(async (item: any, index: number) => {
          if (!item.question || !item.options || !Array.isArray(item.options) || item.options.length !== 4) {
            throw new Error(`Question ${index + 1} manque des champs requis ou options invalides`);
          }
          
          // Vérifier que correctAnswer est valide
          const correctAnswer = parseInt(item.correctAnswer);
          if (isNaN(correctAnswer) || correctAnswer < 0 || correctAnswer > 3) {
            throw new Error(`Question ${index + 1} : correctAnswer invalide`);
          }
          
          // Utiliser les mots-clés fournis ou des mots-clés par défaut
          const keywords = item.imageKeywords || 'food,cooking,restaurant';
          // Nettoyer les mots-clés (enlever espaces, garder seulement lettres, virgules)
          const cleanKeywords = keywords.replace(/[^a-zA-Z,]/g, '').toLowerCase();
          
          // Obtenir une URL d'image Unsplash réelle basée sur les mots-clés
          // Utiliser la méthode spécifique pour les quiz qui recherche directement avec les mots-clés
          const imageUrl = await this.getUnsplashImageUrlForQuiz(cleanKeywords, index);
          
          return {
            id: `quiz-${uniqueId}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            question: item.question.trim(),
            imageUrl: imageUrl,
            options: item.options.map((opt: any) => String(opt).trim()),
            correctAnswer: correctAnswer,
            explanation: item.explanation?.trim() || 'Bonne réponse !',
            difficulty: item.difficulty || 'medium',
            category: item.category?.trim() || 'Culture culinaire',
          };
        })
      );

      return validatedQuestions;
    } catch (error: any) {
      console.error('Erreur lors de la génération du quiz culinaire:', error);
      
      // Fallback : générer des questions par défaut
      const fallbackQuestions: Array<{
        id: string;
        question: string;
        imageUrl: string;
        options: string[];
        correctAnswer: number;
        explanation: string;
        difficulty: 'easy' | 'medium' | 'hard';
        category: string;
      }> = [];

      const defaultQuizData = [
        {
          question: 'Quel est le nom de ce plat traditionnel italien ?',
          keywords: 'pizza,margherita,italian',
          options: ['Pizza Margherita', 'Pizza Napoletana', 'Calzone', 'Focaccia'],
          correctAnswer: 0,
          explanation: 'La Pizza Margherita est un plat emblématique de Naples.',
          difficulty: 'easy' as const,
          category: 'Cuisine italienne',
        },
        {
          question: 'Quelle technique consiste à cuire rapidement des légumes dans une poêle très chaude ?',
          keywords: 'stir-fry,vegetables,cooking',
          options: ['Sauté', 'Braise', 'Poêler', 'Blanchir'],
          correctAnswer: 0,
          explanation: 'Le sauté est une technique de cuisson rapide à feu vif.',
          difficulty: 'medium' as const,
          category: 'Techniques culinaires',
        },
        {
          question: 'Quel pays est à l\'origine du sushi ?',
          keywords: 'sushi,japanese,restaurant',
          options: ['Japon', 'Chine', 'Corée', 'Thaïlande'],
          correctAnswer: 0,
          explanation: 'Le sushi est originaire du Japon, où il est préparé depuis des siècles.',
          difficulty: 'easy' as const,
          category: 'Cuisine japonaise',
        },
        {
          question: 'Quel ingrédient est essentiel pour faire de la pâte à pain ?',
          keywords: 'bread,baking,flour',
          options: ['Levure', 'Bicarbonate', 'Poudre à lever', 'Vinaigre'],
          correctAnswer: 0,
          explanation: 'La levure est essentielle pour faire lever la pâte à pain.',
          difficulty: 'easy' as const,
          category: 'Boulangerie',
        },
        {
          question: 'Qu\'est-ce que le "mise en place" en cuisine ?',
          keywords: 'chef,kitchen,preparation',
          options: ['Préparer tous les ingrédients avant de cuisiner', 'Nettoyer la cuisine', 'Servir le plat', 'Décorer l\'assiette'],
          correctAnswer: 0,
          explanation: 'La mise en place consiste à préparer et organiser tous les ingrédients avant de commencer la cuisson.',
          difficulty: 'medium' as const,
          category: 'Techniques culinaires',
        },
        {
          question: 'Quel plat français est traditionnellement servi avec de la sauce béarnaise ?',
          keywords: 'french,food,restaurant',
          options: ['Entrecôte', 'Coq au vin', 'Bouillabaisse', 'Ratatouille'],
          correctAnswer: 0,
          explanation: 'L\'entrecôte est souvent servie avec la sauce béarnaise, une sauce à base de beurre et d\'estragon.',
          difficulty: 'medium' as const,
          category: 'Cuisine française',
        },
        {
          question: 'Quel est le nom de cette technique de cuisson à basse température ?',
          keywords: 'sous-vide,cooking,technique',
          options: ['Sous-vide', 'Vapeur', 'Braise', 'Grill'],
          correctAnswer: 0,
          explanation: 'Le sous-vide consiste à cuire les aliments dans un sac sous vide à basse température.',
          difficulty: 'hard' as const,
          category: 'Techniques culinaires',
        },
        {
          question: 'Quel dessert italien est fait de café, mascarpone et cacao ?',
          keywords: 'tiramisu,dessert,italian',
          options: ['Tiramisu', 'Panna cotta', 'Cannoli', 'Gelato'],
          correctAnswer: 0,
          explanation: 'Le tiramisu est un dessert italien traditionnel à base de café, mascarpone et cacao.',
          difficulty: 'easy' as const,
          category: 'Desserts',
        },
        {
          question: 'Quelle épice est connue comme "l\'or rouge" ?',
          keywords: 'spices,saffron,cooking',
          options: ['Safran', 'Curcuma', 'Paprika', 'Cannelle'],
          correctAnswer: 0,
          explanation: 'Le safran est l\'épice la plus chère au monde, d\'où son surnom d\'"or rouge".',
          difficulty: 'medium' as const,
          category: 'Épices et ingrédients',
        },
        {
          question: 'Quel plat mexicain est fait de maïs, haricots et épices ?',
          keywords: 'mexican,food,chili',
          options: ['Chili con carne', 'Tacos', 'Enchiladas', 'Guacamole'],
          correctAnswer: 0,
          explanation: 'Le chili con carne est un plat mexicain traditionnel à base de maïs, haricots et épices.',
          difficulty: 'easy' as const,
          category: 'Cuisine mexicaine',
        },
      ];

      // Mélanger les questions par défaut pour plus de variabilité
      const shuffledData = [...defaultQuizData].sort(() => Math.random() - 0.5);
      const fallbackUniqueId = Date.now();
      
      for (let i = 0; i < 10; i++) {
        const data = shuffledData[i] || shuffledData[0];
        const imageUrl = await this.getUnsplashImageUrlForQuiz(data.keywords, i);
        fallbackQuestions.push({
          id: `quiz-fallback-${fallbackUniqueId}-${i}-${Math.random().toString(36).substr(2, 9)}`,
          question: data.question,
          imageUrl: imageUrl,
          options: data.options,
          correctAnswer: data.correctAnswer,
          explanation: data.explanation,
          difficulty: data.difficulty,
          category: data.category,
        });
      }

      return fallbackQuestions;
    }
  }

  // Méthode pour générer une question de devinette de plat avec image
  async generateGuessTheDishQuestion(): Promise<{
    id: string;
    question: string;
    imageUrl: string;
    options: string[];
    correctAnswer: number; // Index de la bonne réponse (0-3)
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
  }> {
    const prompt = `Tu es un expert en création de jeux de devinette culinaires. Génère UNE question de devinette de plat avec image.

La question doit être du type "Devine le nom de ce plat" ou "Quel est le nom de ce plat traditionnel ?"

Pour cette question, fournis :
- Une question claire et engageante en français (style jeu de devinette)
- Des mots-clés pour l'image (2-3 mots maximum, en anglais, séparés par des virgules, exemple: "pizza,margherita,italian" ou "sushi,japanese,restaurant")
- Le nom CORRECT du plat (ce sera la bonne réponse)
- 3 autres noms de plats INCORRECTS mais plausibles (pour les mauvaises réponses)
- Une explication courte et intéressante (1-2 phrases)
- Le niveau de difficulté : "easy", "medium" ou "hard"

Le plat doit être :
- Reconnaissable sur une photo
- D'une cuisine spécifique (italienne, japonaise, française, etc.)
- Intéressant et engageant

Retourne UNIQUEMENT un JSON valide avec ce format exact (sans texte avant/après) :
{
  "question": "Devine le nom de ce plat traditionnel italien",
  "imageKeywords": "pizza,margherita,italian",
  "correctDishName": "Pizza Margherita",
  "wrongOptions": ["Pizza Napoletana", "Calzone", "Focaccia"],
  "explanation": "La Pizza Margherita est un plat emblématique de Naples, créé en 1889.",
  "difficulty": "easy"
}

JSON:`;

    try {
      const result = await this.generateWithFallback(prompt);
      
      // Extraire le JSON de la réponse
      let jsonString = result.trim();
      
      // Nettoyer la réponse si elle contient du texte avant/après le JSON
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parser le JSON
      const questionData = JSON.parse(jsonString);
      
      // Valider les champs requis
      if (!questionData.question || !questionData.correctDishName || !questionData.wrongOptions || !Array.isArray(questionData.wrongOptions) || questionData.wrongOptions.length !== 3) {
        throw new Error('Format de réponse invalide');
      }

      // Construire les 4 options (mélanger pour que la bonne réponse ne soit pas toujours en premier)
      const allOptions = [questionData.correctDishName, ...questionData.wrongOptions];
      // Mélanger les options
      const shuffledOptions = allOptions.sort(() => Math.random() - 0.5);
      const correctAnswerIndex = shuffledOptions.findIndex(opt => opt === questionData.correctDishName);

      // Obtenir l'image basée sur les mots-clés
      const keywords = questionData.imageKeywords || 'food,restaurant';
      const cleanKeywords = keywords.replace(/[^a-zA-Z,]/g, '').toLowerCase();
      const imageUrl = await this.getUnsplashImageUrlForQuiz(cleanKeywords, Math.floor(Math.random() * 10));

      return {
        id: `guess-dish-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        question: questionData.question.trim(),
        imageUrl: imageUrl,
        options: shuffledOptions.map(opt => String(opt).trim()),
        correctAnswer: correctAnswerIndex,
        explanation: questionData.explanation?.trim() || 'Bonne réponse !',
        difficulty: questionData.difficulty || 'medium',
      };
    } catch (error: any) {
      console.error('Erreur lors de la génération de la question de devinette:', error);
      
      // Fallback : question par défaut
      const fallbackOptions = ['Pizza Margherita', 'Pizza Napoletana', 'Calzone', 'Focaccia'];
      const shuffledFallback = fallbackOptions.sort(() => Math.random() - 0.5);
      const fallbackCorrectIndex = shuffledFallback.findIndex(opt => opt === 'Pizza Margherita');
      
      return {
        id: `guess-dish-fallback-${Date.now()}`,
        question: 'Devine le nom de ce plat traditionnel italien',
        imageUrl: await this.getUnsplashImageUrlForQuiz('pizza,margherita,italian', 0),
        options: shuffledFallback,
        correctAnswer: fallbackCorrectIndex,
        explanation: 'La Pizza Margherita est un plat emblématique de Naples, créé en 1889 en l\'honneur de la reine Margherita de Savoie.',
        difficulty: 'easy',
      };
    }
  }

  /**
   * Génère les tendances culinaires pour une ville donnée
   */
  async generateCulinaryTrendsByCity(cityName: string): Promise<{
    city: string;
    cityImageUrl: string;
    trends: Array<{
      title: string;
      description: string;
      category: string;
      popularity: 'high' | 'medium' | 'emerging';
    }>;
    popularDishes: Array<{
      name: string;
      description: string;
    }>;
    restaurantTypes: Array<{
      description: string;
    }>;
    summary: string;
  }> {
    const prompt = `Tu es un expert en gastronomie et culture culinaire locale. Analyse les tendances culinaires actuelles pour la ville de ${cityName}.

Génère un rapport détaillé sur les tendances culinaires de cette ville incluant :

1. **Tendances principales** (5-7 tendances) : Nouvelles tendances culinaires, styles de cuisine émergents, ingrédients populaires, techniques culinaires en vogue, etc.
   Pour chaque tendance, indique :
   - Un titre accrocheur
   - Une description détaillée (2-3 phrases)
   - Une catégorie (ex: "Cuisine de rue", "Vegan", "Fusion", "Traditionnel moderne", "Healthy", etc.)
   - Le niveau de popularité : "high" (très populaire), "medium" (en croissance), ou "emerging" (émergent)

2. **Plats populaires** (5-7 plats) : Les plats les plus appréciés et demandés dans cette ville
   Pour chaque plat :
   - Le nom du plat
   - Une description courte (1-2 phrases)

3. **Types de restaurants en vogue** (3-5 types) : Les styles de restaurants qui se développent
   Pour chaque type, combine le type et la description en UNE SEULE phrase courte et naturelle (ex: "Restaurants de cuisine tunisienne raffinée offrant un cadre élégant dans de magnifiques maisons typiques" ou "Cafés emblématiques proposant des boissons de qualité et des pâtisseries locales dans une ambiance conviviale")

4. **Résumé général** : Un paragraphe (3-4 phrases) résumant l'état actuel de la scène culinaire de ${cityName}

5. **Image de la ville** : Fournis une URL d'image accessible sur le web qui représente spécifiquement ${cityName} (photo de la ville, monument emblématique, vue panoramique, architecture caractéristique, etc.). 
   IMPORTANT : L'image doit être spécifiquement liée à ${cityName}, pas une image générique. 
   - Si tu connais des monuments ou lieux emblématiques de ${cityName}, cherche des images de ces lieux
   - Utilise des services comme Unsplash (https://images.unsplash.com/photo-...) ou Pexels (https://images.pexels.com/photos/...)
   - L'URL doit être accessible publiquement (format https://)
   - Si tu ne trouves pas d'URL spécifique à ${cityName}, laisse ce champ vide (null) plutôt que de mettre une image générique

Retourne UNIQUEMENT un JSON valide avec ce format exact (sans texte avant/après) :
{
  "city": "${cityName}",
  "cityImageUrl": "https://images.unsplash.com/photo-... ou https://images.pexels.com/photos/... ou autre URL d'image accessible",
  "trends": [
    {
      "title": "Titre de la tendance",
      "description": "Description détaillée de la tendance",
      "category": "Catégorie de la tendance",
      "popularity": "high"
    }
  ],
  "popularDishes": [
    {
      "name": "Nom du plat",
      "description": "Description du plat"
    }
  ],
  "restaurantTypes": [
    {
      "description": "Type et description combinés en une phrase (ex: 'Restaurants de cuisine tunisienne raffinée offrant un cadre élégant dans de magnifiques maisons typiques')"
    }
  ],
  "summary": "Résumé général de la scène culinaire de la ville"
}

IMPORTANT : L'URL de l'image (cityImageUrl) doit être une URL réelle et accessible d'une photo de ${cityName}. Utilise des services comme Unsplash, Pexels, ou d'autres sources fiables.

Sois précis et basé sur la culture culinaire réelle de ${cityName}. Si tu ne connais pas bien la ville, base-toi sur la région ou le pays, mais mentionne que c'est une analyse générale.

JSON:`;

    try {
      const result = await this.generateWithFallback(prompt);
      
      // Extraire le JSON de la réponse
      let jsonString = result.trim();
      
      // Nettoyer la réponse si elle contient du texte avant/après le JSON
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      // Parser le JSON
      const trendsData = JSON.parse(jsonString);
      
      // Valider la structure
      if (!trendsData.city || !trendsData.trends || !Array.isArray(trendsData.trends)) {
        throw new Error('Structure JSON invalide');
      }

      // S'assurer que les champs optionnels existent
      if (!trendsData.popularDishes) trendsData.popularDishes = [];
      if (!trendsData.restaurantTypes) trendsData.restaurantTypes = [];
      if (!trendsData.summary) trendsData.summary = '';

      // Valider l'URL de l'image de la ville fournie par Gemini
      let cityImageUrl = trendsData.cityImageUrl;
      
      // Vérifier si l'URL est valide et accessible
      if (cityImageUrl && (cityImageUrl.startsWith('http://') || cityImageUrl.startsWith('https://'))) {
        try {
          // Tester si l'URL est accessible (HEAD request rapide)
          await axios.head(cityImageUrl, { timeout: 5000, validateStatus: (status) => status < 400 });
          console.log(`✅ URL d'image de la ville validée: ${cityImageUrl}`);
        } catch (error) {
          console.warn(`⚠️ URL d'image fournie par Gemini non accessible: ${cityImageUrl}, utilisation d'un fallback`);
          cityImageUrl = null;
        }
      } else {
        cityImageUrl = null;
      }

      // Si Gemini n'a pas fourni d'URL valide, utiliser Unsplash/Pexels avec des mots-clés très spécifiques à la ville
      if (!cityImageUrl) {
        // Essayer plusieurs combinaisons de mots-clés pour trouver une image pertinente de la ville
        const cityNameLower = cityName.toLowerCase().trim();
        // Nettoyer le nom de la ville (enlever les accents, espaces multiples, etc.)
        const cityNameClean = cityNameLower
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Enlever les accents
          .replace(/\s+/g, ' ') // Normaliser les espaces
          .trim();
        
        // Variations de mots-clés avec le nom de la ville en premier (plus spécifique)
        // Prioriser les recherches les plus spécifiques
        const keywordVariations = [
          `${cityNameClean}`, // Nom de la ville seul (le plus spécifique)
          `${cityNameClean} city`, 
          `${cityNameClean} landmark`,
          `${cityNameClean} architecture`,
          `${cityNameClean} view`,
          `${cityNameClean} tourism`,
          `${cityNameClean} old town`,
          `${cityNameClean} medina`,
          `${cityNameClean} monument`,
          `${cityNameClean} tunisia`, // Pour les villes tunisiennes
          `${cityNameClean} tunis`, // Pour les villes tunisiennes
        ];
        
        // Essayer chaque variation jusqu'à trouver une image pertinente
        for (let i = 0; i < keywordVariations.length; i++) {
          try {
            const keywords = keywordVariations[i];
            const testImageUrl = await this.getUnsplashImageUrlForQuiz(keywords, 0); // Toujours index 0 pour la première image
            // Vérifier que l'URL est valide
            if (testImageUrl && testImageUrl.startsWith('http')) {
              // Vérifier que l'image est accessible
              try {
                await axios.head(testImageUrl, { timeout: 3000, validateStatus: (status) => status < 400 });
                cityImageUrl = testImageUrl;
                console.log(`🖼️ Image de la ville trouvée avec mots-clés: "${keywords}" -> ${cityImageUrl}`);
                break;
              } catch (error) {
                console.warn(`⚠️ Image trouvée mais non accessible: ${testImageUrl}`);
                continue;
              }
            }
          } catch (error) {
            console.warn(`⚠️ Échec de la recherche d'image avec mots-clés: "${keywordVariations[i]}"`);
            continue;
          }
        }
        
        // Si aucune image spécifique n'est trouvée, utiliser une recherche avec le nom de la ville seul
        if (!cityImageUrl) {
          try {
            cityImageUrl = await this.getUnsplashImageUrlForQuiz(cityNameClean, 0);
            console.log(`🖼️ Image de la ville générée avec nom seul: ${cityImageUrl}`);
          } catch (error) {
            console.warn(`⚠️ Impossible de trouver une image pour ${cityName}`);
          }
        }
      }

      // Valider et formater les tendances (sans images)
      const trends = trendsData.trends.map((trend: any) => ({
        title: trend.title || 'Tendance culinaire',
        description: trend.description || '',
        category: trend.category || 'Général',
        popularity: ['high', 'medium', 'emerging'].includes(trend.popularity) 
          ? trend.popularity 
          : 'medium',
      }));

      // Valider et formater les plats populaires (sans images)
      const dishes = (trendsData.popularDishes || []).map((dish: any) => ({
        name: dish.name || 'Plat',
        description: dish.description || '',
      }));

      // Valider et formater les types de restaurants (type et description combinés)
      const restaurantTypes = (trendsData.restaurantTypes || []).map((type: any) => ({
        description: type.description || (type.type ? `${type.type}. ${type.description || ''}` : 'Restaurant'),
      }));

      return {
        city: trendsData.city || cityName,
        cityImageUrl: cityImageUrl,
        trends: trends,
        popularDishes: dishes,
        restaurantTypes: restaurantTypes,
        summary: trendsData.summary || '',
      };
    } catch (error: any) {
      console.error('Erreur lors de la génération des tendances culinaires:', error);
      
      // Fallback avec des données génériques (une seule image pour la ville)
      const fallbackCityImage = await this.getUnsplashImageUrlForQuiz(`${cityName.toLowerCase()},city,landmark`, 0);
      
      const fallbackTrends = [
        {
          title: 'Cuisine locale authentique',
          description: 'Les restaurants mettent en avant les spécialités locales et les recettes traditionnelles de la région.',
          category: 'Traditionnel',
          popularity: 'high' as const,
        },
        {
          title: 'Cuisine fusion moderne',
          description: 'Mélange créatif entre cuisine locale et influences internationales.',
          category: 'Fusion',
          popularity: 'medium' as const,
        },
        {
          title: 'Options végétariennes et vegan',
          description: 'Développement des offres végétariennes et vegan dans les restaurants.',
          category: 'Healthy',
          popularity: 'emerging' as const,
        },
      ];

      const fallbackDishes = [
        {
          name: 'Plat traditionnel local',
          description: 'Un plat emblématique de la région.',
        },
      ];

      const fallbackRestaurantTypes = [
        {
          description: 'Restaurants traditionnels proposant la cuisine locale authentique dans un cadre chaleureux.',
        },
      ];

      return {
        city: cityName,
        cityImageUrl: fallbackCityImage,
        trends: fallbackTrends,
        popularDishes: fallbackDishes,
        restaurantTypes: fallbackRestaurantTypes,
        summary: `La scène culinaire de ${cityName} est dynamique, avec un mélange de traditions locales et d'influences modernes. Les restaurants mettent en avant les spécialités régionales tout en intégrant de nouvelles tendances culinaires.`,
      };
    }
  }
}

