import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Restaurant, RestaurantDocument, Dish } from './restaurant.schema';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { AddReviewDto } from './dto/add-review.dto';
import { LinkReelToRestaurantDto } from './dto/link-reel.dto';
import { AddDishDto } from './dto/add-dish.dto';
import { RestaurantChatbotDto } from './dto/restaurant-chatbot.dto';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument } from '../users/user.schema';
import { Reel, ReelDocument } from '../reels/reel.schema';
import { GeminiService } from './gemini.service';

export type ChatbotStep = 'peopleCount' | 'profile' | 'budget' | 'availability' | 'cuisine' | 'dietaryRestrictions' | 'recommendations';

export interface ChatbotContext {
  peopleCount: number;
  profile: string;
  budget: string;
  availability: string;
  cuisine?: string;
  dietaryRestrictions?: string;
}

interface ChatbotRestaurantPayload {
  id: string;
  name: string;
  address: string;
  rating: number;
  averagePrice?: number | null;
  menuHighlights: Array<{ name: string; price?: number }>;
}

@Injectable()
export class RestaurantsService {
  constructor(
    @InjectModel(Restaurant.name)
    private restaurantModel: Model<RestaurantDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Reel.name)
    private reelModel: Model<ReelDocument>,
    private geminiService: GeminiService,
  ) {}

  // Créer un restaurant
  async createRestaurant(
    currentUser: { user_id: string; username?: string },
    dto: CreateRestaurantDto,
  ) {
    // Préparer le menu si des plats sont fournis
    const menu: Dish[] = [];
    if (dto.menu && dto.menu.length > 0) {
      for (const dish of dto.menu) {
        const dishImage = dish.image
          ? dish.image.startsWith('http')
            ? dish.image // URL externe
            : `/uploads/restaurants-images/dishes/${dish.image}` // Photo prédéfinie
          : undefined;

        menu.push({
          id: uuidv4(),
          name: dish.name,
          description: dish.description,
          price: dish.price,
          image: dishImage,
        });
      }
    }

    const created = await this.restaurantModel.create({
      id: uuidv4(),
      ownerId: currentUser.user_id,
      ownerUsername: currentUser.username || 'Unknown',
      name: dto.name,
      address: dto.address,
      description: dto.description || '',
      photos: [dto.photo],
      rating: 0,
      reviews: [],
      menu: menu, // Utiliser le menu préparé
      reels: [],
      tags: [],
    });

    // Générer automatiquement les tags après la création
    try {
      const tags = await this.geminiService.generateRestaurantTags(
        created.name,
        created.address,
        created.description,
        created.menu,
        created.reviews,
        created.rating,
      );
      created.tags = tags;
      await created.save();
    } catch (error) {
      console.error('Erreur lors de la génération automatique des tags:', error);
      // Ne pas faire échouer la création si la génération de tags échoue
    }

    return created;
  }

  // Récupérer un restaurant par ID
  async getRestaurant(id: string) {
    const restaurant = await this.restaurantModel.findOne({ id });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    return restaurant;
  }

  // Récupérer l'adresse d'un restaurant par ID
  async getRestaurantAddress(id: string) {
    const restaurant = await this.restaurantModel.findOne({ id });
    if (!restaurant) throw new NotFoundException('Restaurant not found');
    
    return {
      address: restaurant.address,
    };
  }

  // Récupérer tous les détails d'un restaurant par ID
  async getRestaurantDetails(id: string) {
    const restaurant = await this.restaurantModel.findOne({ id });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    // Formater les photos du restaurant avec le chemin complet
    const formatPhoto = (photo: string): string => {
      if (!photo) return photo;
      // Si l'image commence par http:// ou https://, c'est une URL externe
      if (photo.startsWith('http://') || photo.startsWith('https://')) {
        return photo;
      }
      // Sinon, c'est une photo prédéfinie dans uploads/restaurants-images/
      return `/uploads/restaurants-images/${photo}`;
    };

    const formattedPhotos = restaurant.photos
      ? restaurant.photos.map(formatPhoto)
      : [];

    return {
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.address,
      description: restaurant.description,
      photo: formattedPhotos.length > 0 ? formattedPhotos[0] : null,
      photos: formattedPhotos,
      predefinedPhoto: restaurant.predefinedPhoto,
      ownerId: restaurant.ownerId,
      ownerUsername: restaurant.ownerUsername,
      rating: restaurant.rating,
      reviews: restaurant.reviews,
      menu: restaurant.menu,
      reels: restaurant.reels,
      tags: restaurant.tags || [],
    };
  }

  // Mettre à jour un restaurant
  async updateRestaurant(id: string, dto: UpdateRestaurantDto) {
    const restaurant = await this.getRestaurant(id);

    if (dto.name) restaurant.name = dto.name;
    if (dto.address) restaurant.address = dto.address;
    if (dto.description !== undefined) restaurant.description = dto.description;

    if (dto.photo) {
      restaurant.photos = [dto.photo];
    }

    await restaurant.save();
    return restaurant;
  }

  // Ajouter ou mettre à jour une review
  async addReview(id: string, userId: string, dto: AddReviewDto) {
    const restaurant = await this.getRestaurant(id);
    const reviewId = uuidv4();

    // Permettre plusieurs reviews par utilisateur : on n'efface plus les anciennes
    const reviewString = `${reviewId}|${userId}|${dto.rating}|${dto.comment}`;
    restaurant.reviews.push(reviewString);

    // Recalculer la moyenne des ratings
    const allRatings = restaurant.reviews.map((r) => Number(r.split('|')[2]));
    restaurant.rating = Number(
      (allRatings.reduce((a, b) => a + b, 0) / allRatings.length).toFixed(2),
    );

    await restaurant.save();

    return {
      message: 'Review added',
      reviewId,
      userId,
      newRating: restaurant.rating,
    };
  }

  // Lier un reel à un restaurant
  async linkReel(id: string, dto: LinkReelToRestaurantDto) {
    const restaurant = await this.getRestaurant(id);
    if (!restaurant.reels.includes(dto.reelId)) restaurant.reels.push(dto.reelId);
    await restaurant.save();
    return { message: 'Reel linked to restaurant' };
  }

  // Ajouter un plat au menu
  async addDish(id: string, dto: AddDishDto) {
    const restaurant = await this.getRestaurant(id);
    const dishId = uuidv4();

    // Déterminer l'URL de l'image
    let imageUrl: string | undefined;
    if (dto.image) {
      // Si l'image commence par http:// ou https://, c'est une URL externe
      if (dto.image.startsWith('http://') || dto.image.startsWith('https://')) {
        imageUrl = dto.image;
      } else {
        // Sinon, c'est une photo prédéfinie dans uploads/restaurants-images/dishes/
        imageUrl = `/uploads/restaurants-images/dishes/${dto.image}`;
      }
    }

    const dish = {
      id: dishId,
      name: dto.name,
      description: dto.description,
      price: dto.price,
      image: imageUrl,
    };

    restaurant.menu.push(dish as any);
    await restaurant.save();
    return { message: 'Dish added to menu', dish };
  }

  // Récupérer tous les plats de tous les restaurants
  async getAllDishes() {
    const restaurants = await this.restaurantModel.find();

    const dishes = restaurants.flatMap((restaurant) =>
      (restaurant.menu || []).map((dish) => ({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        dishId: dish.id,
        name: dish.name,
        description: dish.description,
        price: dish.price,
        image: dish.image,
      })),
    );

    return dishes;
  }

  // Générer une recette pour un plat donné (par son dishId) en utilisant son image
  async getDishRecipe(dishId: string) {
    const restaurant = await this.restaurantModel.findOne({ 'menu.id': dishId });
    if (!restaurant) {
      throw new NotFoundException('Plat non trouvé');
    }

    const dish = restaurant.menu.find((d) => d.id === dishId);
    if (!dish) {
      throw new NotFoundException('Plat non trouvé dans le restaurant');
    }

    // Construire une URL d'image exploitable
    let imageUrl: string | null = null;
    const imageSource = dish.image || (restaurant.photos && restaurant.photos[0]) || null;

    if (imageSource) {
      if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
        imageUrl = imageSource;
      } else {
        const baseURL = process.env.BACKEND_URL || process.env.BASE_URL || 'http://localhost:3000';
        const normalizedPath = imageSource.startsWith('/') ? imageSource : `/uploads/restaurants-images/dishes/${imageSource}`;
        imageUrl = `${baseURL}${normalizedPath}`;
      }
    }

    const steps = await this.geminiService.generateRecipeFromDishImage(
      imageUrl,
      dish.name,
      restaurant.name,
    );

    return {
      dishId: dish.id,
      dishName: dish.name,
      steps,
    };
  }

  async handleChatbotConversation(dto?: RestaurantChatbotDto) {
    const userPayload = dto || ({} as RestaurantChatbotDto);

    const sanitized = {
      peopleCount: userPayload.peopleCount,
      profile: userPayload.profile?.trim(),
      budget: userPayload.budget?.trim(),
      availability: userPayload.availability?.trim(),
      cuisine: userPayload.cuisine?.trim(),
      dietaryRestrictions: userPayload.dietaryRestrictions?.trim(),
    };

    if (!sanitized.peopleCount) {
      return {
        status: 'awaiting',
        step: 'peopleCount' as ChatbotStep,
        question: this.getChatbotQuestion('peopleCount'),
        context: sanitized,
      };
    }

    if (!sanitized.profile) {
      return {
        status: 'awaiting',
        step: 'profile' as ChatbotStep,
        question: this.getChatbotQuestion('profile'),
        context: sanitized,
      };
    }

    if (!sanitized.budget) {
      return {
        status: 'awaiting',
        step: 'budget' as ChatbotStep,
        question: this.getChatbotQuestion('budget'),
        context: sanitized,
      };
    }

    if (!sanitized.availability) {
      return {
        status: 'awaiting',
        step: 'availability' as ChatbotStep,
        question: this.getChatbotQuestion('availability'),
        context: sanitized,
      };
    }

    if (!sanitized.cuisine) {
      return {
        status: 'awaiting',
        step: 'cuisine' as ChatbotStep,
        question: this.getChatbotQuestion('cuisine'),
        context: sanitized,
      };
    }

    if (!sanitized.dietaryRestrictions) {
      return {
        status: 'awaiting',
        step: 'dietaryRestrictions' as ChatbotStep,
        question: this.getChatbotQuestion('dietaryRestrictions'),
        context: sanitized,
      };
    }

    const context: ChatbotContext = {
      peopleCount: sanitized.peopleCount,
      profile: sanitized.profile,
      budget: sanitized.budget,
      availability: sanitized.availability,
      cuisine: sanitized.cuisine,
      dietaryRestrictions: sanitized.dietaryRestrictions,
    };

    const restaurants = await this.restaurantModel.find().sort({ rating: -1 });
    if (restaurants.length === 0) {
      return {
        status: 'completed',
        step: 'recommendations' as ChatbotStep,
        context,
        recommendations: [],
        message: 'Aucun restaurant n\'est disponible pour le moment.',
      };
    }

    const restaurantPayload = this.buildRestaurantPayloadForChatbot(restaurants);
    const recommendations = await this.geminiService.generateChatbotRecommendations(context, restaurantPayload);

    return {
      status: 'completed',
      step: 'recommendations' as ChatbotStep,
      context,
      recommendations,
      message: 'Voici les meilleures options selon vos réponses.',
    };
  }

  // Récupérer tous les restaurants triés par rating
  async getAll() {
    return await this.restaurantModel.find().sort({ rating: -1 });
  }

  // Recommander et classer les restaurants avec tags (hot/average/cold)
  async getRecommendedRestaurants(): Promise<Array<{ id: string; tag: 'hot' | 'average' | 'cold' }>> {
    // Récupérer tous les restaurants
    const restaurants = await this.restaurantModel.find();

    if (restaurants.length === 0) {
      return [];
    }

    // Préparer les données pour l'analyse Gemini
    const restaurantsData = await Promise.all(
      restaurants.map(async (restaurant) => {
        // Extraire un résumé des reviews
        let reviewsSummary = '';
        if (restaurant.reviews && restaurant.reviews.length > 0) {
          try {
            // Utiliser un résumé court des reviews
            const comments = restaurant.reviews
              .map((review) => {
                const parts = review.split('|');
                return parts.length >= 4 ? parts[3] : null;
              })
              .filter((c) => c && c.trim().length > 0)
              .slice(0, 3) // Limiter à 3 commentaires pour le résumé
              .join('; ');
            
            reviewsSummary = comments || 'Aucun commentaire';
          } catch (error) {
            reviewsSummary = 'Reviews non analysables';
          }
        } else {
          reviewsSummary = 'Aucune review';
        }

        return {
          id: restaurant.id,
          name: restaurant.name,
          rating: restaurant.rating || 0,
          reviewsCount: restaurant.reviews?.length || 0,
          reviewsSummary: reviewsSummary.substring(0, 200), // Limiter la longueur
        };
      })
    );

    // Analyser et classer avec Gemini
    const ranked = await this.geminiService.analyzeAndRankRestaurants(restaurantsData);

    return ranked;
  }

  // Résumer les reviews d'un restaurant avec Gemini AI
  async summarizeReviews(id: string) {
    const restaurant = await this.getRestaurant(id);
    const summary = await this.geminiService.summarizeReviews(restaurant.reviews);
    return {
      restaurantId: id,
      restaurantName: restaurant.name,
      summary,
    };
  }

  // Générer une description du restaurant avec Gemini AI
  async generateDescription(id: string) {
    const restaurant = await this.getRestaurant(id);
    const description = await this.geminiService.generateDescription(
      restaurant.name,
      restaurant.address,
      restaurant.reviews,
      restaurant.menu,
    );
    
    // Mettre à jour la description du restaurant
    restaurant.description = description;
    await restaurant.save();

    return {
      restaurantId: id,
      restaurantName: restaurant.name,
      generatedDescription: description,
    };
  }

  // Générer un résumé complet basé sur reviews, ratings, adresse et photos
  async generateCompleteSummary(id: string) {
    const restaurant = await this.getRestaurant(id);
    
    // Formater les photos
    const formatPhoto = (photo: string): string => {
      if (!photo) return photo;
      if (photo.startsWith('http://') || photo.startsWith('https://')) {
        return photo;
      }
      return `/uploads/restaurants-images/${photo}`;
    };

    const formattedPhotos = restaurant.photos
      ? restaurant.photos.map(formatPhoto)
      : [];

    const summary = await this.geminiService.generateCompleteSummary(
      restaurant.name,
      restaurant.address,
      restaurant.reviews,
      restaurant.rating,
      formattedPhotos,
      restaurant.menu,
    );
    
    // Mettre à jour la description du restaurant avec le résumé
    restaurant.description = summary;
    await restaurant.save();

    return {
      restaurantId: id,
      restaurantName: restaurant.name,
      summary,
    };
  }

  // Récupérer 10 nouvelles/recommandations/astuces quotidiennes sur le monde culinaire
  async getDailyCulinaryNews() {
    return await this.geminiService.generateDailyCulinaryNews();
  }

  // Récupérer un quiz culinaire quotidien généré par Gemini AI
  async getDailyCulinaryQuiz() {
    return await this.geminiService.generateDailyCulinaryQuiz();
  }

  // Générer une question de devinette de plat avec image
  async generateGuessTheDishQuestion() {
    return await this.geminiService.generateGuessTheDishQuestion();
  }

  // Analyser et générer des tags pour un restaurant avec Gemini AI
  async analyzeRestaurantTags(id: string) {
    const restaurant = await this.getRestaurant(id);
    
    const tags = await this.geminiService.generateRestaurantTags(
      restaurant.name,
      restaurant.address,
      restaurant.description,
      restaurant.menu,
      restaurant.reviews,
      restaurant.rating,
    );
    
    // Mettre à jour les tags du restaurant
    restaurant.tags = tags;
    await restaurant.save();

    return {
      restaurantId: id,
      restaurantName: restaurant.name,
      tags,
      count: tags.length,
    };
  }

  private getChatbotQuestion(step: ChatbotStep): string {
    switch (step) {
      case 'peopleCount':
        return 'Combien de personnes souhaitent manger ?';
      case 'profile':
        return 'Quel est votre profil ? (ex: étudiant, couple, famille, business...)';
      case 'budget':
        return 'Quel est votre budget approximatif par personne ?';
      case 'availability':
        return 'Quel créneau ou moment préférez-vous (ex: midi en semaine, soir, week-end) ?';
      case 'cuisine':
        return 'Quel type de cuisine préférez-vous ? (ex: italienne, française, asiatique, libanaise, mexicaine, etc. - vous pouvez dire "aucune préférence" si vous êtes ouvert)';
      case 'dietaryRestrictions':
        return 'Avez-vous des restrictions alimentaires ou des préférences diététiques ? (ex: halal, sans gluten, végétarien, vegan, sans lactose, casher, etc. - vous pouvez dire "aucune" si cela ne s\'applique pas)';
      default:
        return 'Comment puis-je vous aider pour votre sortie au restaurant ?';
    }
  }

  private estimateAveragePrice(menu: Dish[] = []): number | null {
    const prices = menu
      .map((dish) => (typeof dish.price === 'number' ? dish.price : null))
      .filter((price): price is number => price !== null && price !== undefined);

    if (!prices.length) {
      return null;
    }

    const average = prices.reduce((acc, price) => acc + price, 0) / prices.length;
    return Number(average.toFixed(2));
  }

  private buildRestaurantPayloadForChatbot(restaurants: RestaurantDocument[]): ChatbotRestaurantPayload[] {
    return restaurants.slice(0, 15).map((restaurant) => {
      const menuHighlights = (restaurant.menu || []).slice(0, 5).map((dish) => ({
        name: dish.name,
        price: dish.price,
      }));

      return {
        id: restaurant.id,
        name: restaurant.name,
        address: restaurant.address,
        rating: restaurant.rating || 0,
        averagePrice: this.estimateAveragePrice(restaurant.menu || []),
        menuHighlights,
      };
    });
  }

  // Récupérer les tendances culinaires par ville avec Gemini AI
  async getCulinaryTrendsByCity(cityName: string) {
    if (!cityName || cityName.trim().length === 0) {
      throw new BadRequestException('Le nom de la ville est requis');
    }
    
    return await this.geminiService.generateCulinaryTrendsByCity(cityName.trim());
  }
  
}
