import { Controller, Post, Get, Patch, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiParam, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { AddReviewDto } from './dto/add-review.dto';
import { LinkReelToRestaurantDto } from './dto/link-reel.dto';
import { AddDishDto } from './dto/add-dish.dto';
import { RestaurantChatbotDto } from './dto/restaurant-chatbot.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';

@ApiTags('Restaurants')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly service: RestaurantsService) {}

  @Post()
  @ApiOperation({ summary: 'Créer un restaurant pour l\'utilisateur connecté' })
  @ApiBody({ type: CreateRestaurantDto })
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreateRestaurantDto,
  ) {
    return await this.service.createRestaurant(user, dto);
  }

  @Public()
  @Get('daily-news')
  @ApiOperation({ summary: 'Récupérer 10 nouvelles/recommandations/astuces quotidiennes sur le monde culinaire générées par Gemini AI' })
  async getDailyCulinaryNews() {
    return await this.service.getDailyCulinaryNews();
  }

  @Public()
  @Get('quiz/daily')
  @ApiOperation({ 
    summary: 'Récupérer un quiz culinaire quotidien interactif (10 questions) généré par Gemini AI avec images Unsplash',
    description: 'Génère 10 questions de quiz culinaire de qualité professionnelle (style Kahoot) avec images, options multiples, et explications. Chaque question inclut une image depuis Unsplash, 4 options de réponse, et une explication détaillée.'
  })
  async getDailyCulinaryQuiz() {
    const quiz = await this.service.getDailyCulinaryQuiz();
    return {
      quiz,
      count: quiz.length,
      date: new Date().toISOString(),
    };
  }

  @Public()
  @Get('quiz/guess-the-dish')
  @ApiOperation({ 
    summary: 'Générer une question de devinette de plat avec image (Devine le nom du plat)',
    description: 'Génère une question de devinette où l\'utilisateur doit deviner le nom d\'un plat à partir d\'une image. Gemini génère la question, les mots-clés pour l\'image, et 4 options de réponse (1 correcte + 3 incorrectes).'
  })
  async generateGuessTheDishQuestion() {
    return await this.service.generateGuessTheDishQuestion();
  }

  @Public()
  @Get('trends/:city')
  @ApiOperation({ 
    summary: 'Récupérer les tendances culinaires d\'une ville avec Gemini AI',
    description: 'Analyse les tendances culinaires actuelles d\'une ville donnée, incluant les tendances principales, plats populaires, types de restaurants en vogue, et un résumé général de la scène culinaire.'
  })
  @ApiParam({ 
    name: 'city', 
    description: 'Nom de la ville (ex: Tunis, Paris, New York)',
    example: 'Tunis'
  })
  async getCulinaryTrendsByCity(@Param('city') city: string) {
    return await this.service.getCulinaryTrendsByCity(city);
  }

  @Public()
  @Get('recommended')
  @ApiOperation({ summary: 'Récupérer les restaurants recommandés classés du meilleur au pire avec tags (hot/average/cold) basé sur reviews et ratings' })
  async getRecommendedRestaurants() {
    return await this.service.getRecommendedRestaurants();
  }

  @Public()
  @Get(':id/details')
  @ApiOperation({ summary: 'Récupérer tous les détails d\'un restaurant par ID' })
  @ApiParam({ name: 'id' })
  async getRestaurantDetails(@Param('id') id: string) {
    return await this.service.getRestaurantDetails(id);
  }

  @Public()
  @Get(':id/adresse')
  @ApiOperation({ summary: 'Récupérer l\'adresse d\'un restaurant par ID' })
  @ApiParam({ name: 'id' })
  async getRestaurantAddress(@Param('id') id: string) {
    return await this.service.getRestaurantAddress(id);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Récupérer les informations d\'un restaurant par ID' })
  @ApiParam({ name: 'id' })
  async getRestaurant(@Param('id') id: string) {
    return await this.service.getRestaurant(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour un restaurant existant' })
  @ApiBody({ type: UpdateRestaurantDto })
  async updateRestaurant(@Param('id') id: string, @Body() dto: UpdateRestaurantDto) {
    return await this.service.updateRestaurant(id, dto);
  }

  @Post(':id/reviews')
  @ApiOperation({ summary: 'Ajouter ou mettre à jour une review pour un restaurant' })
  @ApiBody({ type: AddReviewDto })
  async addReview(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AddReviewDto) {
    console.log('📝 Add Review - User from CurrentUser:', user);
    console.log('📝 Add Review - Restaurant ID:', id);
    console.log('📝 Add Review - DTO:', dto);

    // Validation: s'assurer que l'utilisateur connecté utilise son propre ID
    // L'ID utilisateur dans la review sera toujours celui de l'utilisateur connecté
    const reviewerUserId = user.user_id;

    // Empêcher le propriétaire du restaurant de noter son propre restaurant
    const restaurant = await this.service.getRestaurant(id);
    if (restaurant.ownerId === reviewerUserId) {
      throw new BadRequestException('Le propriétaire du restaurant ne peut pas noter son propre établissement');
    }

    return await this.service.addReview(id, reviewerUserId, dto);
  }

  @Post(':id/link-reel')
  @ApiOperation({ summary: 'Lier un reel à un restaurant' })
  @ApiBody({ type: LinkReelToRestaurantDto })
  async linkReel(@Param('id') id: string, @Body() dto: LinkReelToRestaurantDto) {
    return await this.service.linkReel(id, dto);
  }

  @Post(':id/menu')
  @ApiOperation({ summary: 'Ajouter un plat au menu du restaurant' })
  @ApiBody({ type: AddDishDto })
  async addDish(@Param('id') id: string, @Body() dto: AddDishDto) {
    return await this.service.addDish(id, dto);
  }

  @Public()
  @Post(':id/generate-summary')
  @ApiOperation({ summary: 'Générer un résumé complet du restaurant avec Gemini AI basé sur reviews, ratings, adresse et photos' })
  @ApiParam({ name: 'id' })
  async generateCompleteSummary(@Param('id') id: string) {
    return await this.service.generateCompleteSummary(id);
  }

  @Public()
  @Post(':id/generate-tags')
  @ApiOperation({ summary: 'Analyser et générer des tags pour un restaurant avec Gemini AI basé sur le nom, adresse, description, menu et reviews' })
  @ApiParam({ name: 'id' })
  async analyzeRestaurantTags(@Param('id') id: string) {
    return await this.service.analyzeRestaurantTags(id);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Récupérer tous les restaurants triés par rating' })
  async getAll() {
    return await this.service.getAll();
  }

  @Public()
  @Get('dishes/all')
  @ApiOperation({
    summary: 'Récupérer tous les plats de tous les restaurants',
    description:
      'Retourne la liste plate de tous les plats, avec l\'identifiant et le nom du restaurant d\'origine.',
  })
  async getAllDishes() {
    return await this.service.getAllDishes();
  }

  @Public()
  @Get('dishes/:dishId/recipe')
  @ApiOperation({
    summary: 'Générer une recette pour un plat en analysant son image et son nom avec Gemini',
    description:
      'À partir du dishId (UUID du plat), retrouve le plat, construit l’URL de son image et demande à Gemini une recette détaillée.',
  })
  @ApiParam({ name: 'dishId', description: 'Identifiant unique du plat (dishId)' })
  async getDishRecipe(@Param('dishId') dishId: string) {
    return await this.service.getDishRecipe(dishId);
  }

  @Public()
  @Post('chatbot')
  @ApiOperation({
    summary: 'Chatbot Gemini pour recommander 3 restaurants avec menu selon le profil utilisateur',
  })
  @ApiBody({
    description:
      'Fournissez progressivement les informations demandées par le chatbot. Sans corps, il commence par poser la première question.',
    schema: {
      type: 'object',
      properties: {
        peopleCount: { type: 'number', example: 2, description: 'Nombre de personnes' },
        profile: { type: 'string', example: 'couple', description: 'Type de client (étudiant, famille, business, etc.)' },
        budget: { type: 'string', example: '20-30€', description: 'Budget par personne' },
        availability: { type: 'string', example: 'Samedi soir', description: 'Créneau ou moment souhaité' },
      },
    },
  })
  @ApiOkResponse({
    description:
      "Structure de réponse du chatbot. Lorsque toutes les informations sont fournies, le chatbot renvoie 3 suggestions personnalisées.",
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'awaiting' },
        step: { type: 'string', example: 'peopleCount' },
        question: { type: 'string', example: 'Combien de personnes souhaitent manger ?' },
        context: {
          type: 'object',
          properties: {
            peopleCount: { type: 'number', nullable: true },
            profile: { type: 'string', nullable: true },
            budget: { type: 'string', nullable: true },
            availability: { type: 'string', nullable: true },
          },
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              matchReason: { type: 'string' },
              menuSuggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    price: { type: 'number', nullable: true },
                  },
                },
              },
              estimatedCostPerPerson: { type: 'string', nullable: true },
              availabilityNote: { type: 'string', nullable: true },
              friendlyMessage: { type: 'string', nullable: true },
            },
          },
        },
        message: { type: 'string', example: 'Voici les meilleures options selon vos réponses.' },
      },
    },
  })
  async chatbot(@Body() dto: RestaurantChatbotDto) {
    return await this.service.handleChatbotConversation(dto);
  }
  
}