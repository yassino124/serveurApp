import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Query,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}

@ApiTags('Messages')
@ApiBearerAuth('JWT-auth')
@Controller('api/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('inbox')
  @ApiOperation({ summary: 'Obtenir mes messages' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Messages récupérés avec succès',
  })
  async getMessages(
    @CurrentUser() user: any,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ): Promise<ApiResponse<any>> {
    const result = await this.messagesService.getUserMessages(
      user.user_id,
      page,
      limit,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Messages récupérés avec succès',
      data: result,
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Obtenir le nombre de messages non lus' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Nombre de messages non lus récupéré',
  })
  async getUnreadCount(
    @CurrentUser() user: any,
  ): Promise<ApiResponse<any>> {
    const result = await this.messagesService.getUnreadCount(user.user_id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Nombre de messages non lus récupéré',
      data: result,
    };
  }

  @Put(':messageId/read')
  @ApiOperation({ summary: 'Marquer un message comme lu' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Message marqué comme lu',
  })
  async markAsRead(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ): Promise<ApiResponse<any>> {
    const message = await this.messagesService.markAsRead(messageId, user.user_id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Message marqué comme lu',
      data: message,
    };
  }

  @Put('read-all')
  @ApiOperation({ summary: 'Marquer tous les messages comme lus' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tous les messages marqués comme lus',
  })
  async markAllAsRead(
    @CurrentUser() user: any,
  ): Promise<ApiResponse<any>> {
    const result = await this.messagesService.markAllAsRead(user.user_id);

    return {
      statusCode: HttpStatus.OK,
      message: `${result.modified_count} messages marqués comme lus`,
      data: result,
    };
  }

  @Delete(':messageId')
  @ApiOperation({ summary: 'Supprimer un message' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Message supprimé avec succès',
  })
  async deleteMessage(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ): Promise<ApiResponse<any>> {
    const result = await this.messagesService.deleteMessage(messageId, user.user_id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Message supprimé avec succès',
      data: result,
    };
  }
}