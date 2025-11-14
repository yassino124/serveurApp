// src/modules/reels/reels.controller.ts
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
import { v4 as uuidv4 } from 'uuid';

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

  constructor(private readonly reelsService: ReelsService) {}

  @Post()
  @ApiOperation({ summary: 'Créer un nouveau reel' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Reel créé avec succès',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Données invalides',
  })
  @ApiBody({ type: CreateReelDto })
  async createReel(
    @CurrentUser() user: any,
    @Body() createReelDto: CreateReelDto,
  ): Promise<ApiResponse<any>> {
    this.logger.debug(`CurrentUser object: ${JSON.stringify(user)}`);
    
    const userId = user.user_id;
    
    if (!userId) {
      this.logger.error('User ID not found in user object:', user);
      throw new Error('User ID not found in authentication token');
    }

    this.logger.log(`Creating reel for user ID: ${userId}`);
    this.logger.log(`CreateReelDto: ${JSON.stringify(createReelDto)}`);
    
    const reel = await this.reelsService.createReel(userId, createReelDto);
    
    // ✅ DÉBOGAGE CRITIQUE
    this.logger.log(`Reel created: ${reel ? 'YES' : 'NO'}`);
    if (reel) {
      this.logger.log(`Reel ID: ${reel.reel_id || reel._id || 'NO ID'}`);
      this.logger.log(`Reel data keys: ${Object.keys(reel).join(', ')}`);
    } else {
      this.logger.error('❌ CRITICAL: Service returned null/undefined reel!');
    }

    // ✅ Vérification avant de retourner
    if (!reel) {
      throw new Error('Failed to create reel: Service returned no data');
    }

    const response = {
      statusCode: HttpStatus.CREATED,
      message: 'Reel créé avec succès',
      data: reel,
    };
    
    this.logger.log(`Response: ${JSON.stringify(response)}`);
    
    return response;
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
  ): Promise<ApiResponse<any[]>> {  // ✅ Type de retour explicite
    const userId = user.user_id;
    
    this.logger.debug(`Fetching For You feed for user: ${userId}`);
    
    const reels = await this.reelsService.getForYouFeed(userId, page, limit);
    
    // ✅ Gestion des cas où aucun reel n'est retourné
    if (!reels || reels.length === 0) {
      this.logger.log(`No reels found for user ${userId}`);
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
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Feed "For You" récupéré avec succès',
      data: reels,
      pagination: {
        page,
        limit,
        has_more: reels.length === limit,
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
}