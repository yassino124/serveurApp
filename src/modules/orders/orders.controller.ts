import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpStatus,
  UseGuards,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderStatus, PaymentStatus, PaymentMethod } from './order.schema'; // ✅ AJOUT: Import des enums
import { AcceptOrderDto } from './dto/accept-order.dto';


interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@Controller('api/orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Créer une nouvelle commande à partir d\'un reel',
    description: 'Le prix est automatiquement récupéré depuis le menu du restaurant. Optionnellement, un prix personnalisé peut être fourni.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Commande créée avec succès',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Reel non trouvé',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Impossible de commander son propre reel',
  })
  @ApiBody({
    type: CreateOrderDto,
    examples: {
      basic: {
        summary: 'Commande basique',
        value: {
          reel_id: 'uuid-reel-123',
          quantity: 2,
          customer_notes: 'Sans piment s\'il vous plaît'
        }
      },
      customPrice: {
        summary: 'Commande avec prix personnalisé',
        value: {
          reel_id: 'uuid-reel-123',
          quantity: 2,
          custom_unit_price: 15.5,
          customer_notes: 'Extra fromage'
        }
      }
    }
  })
  async createOrder(
    @CurrentUser() user: any,
    @Body() createOrderDto: CreateOrderDto,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`🎯 Création commande par: ${user.user_id}`);
    this.logger.log(`📦 Détails commande: ${JSON.stringify(createOrderDto)}`);

    try {
      const order = await this.ordersService.createOrder(
        user.user_id,
        createOrderDto,
      );

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Commande créée avec succès! Le restaurant a été notifié.',
        data: {
          ...order.toObject(),
          tracking: {
            websocket_room: `user_${user.user_id}`,
            real_time_updates: true
          }
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erreur création commande: ${error.message}`);
      throw error;
    }
  }

  @Get('my-orders')
  @ApiOperation({ 
    summary: 'Obtenir mes commandes (client)',
    description: 'Retourne toutes les commandes de l\'utilisateur connecté, triées par date de création'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Liste des commandes récupérée avec succès',
  })
  async getUserOrders(
    @CurrentUser() user: any,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`📋 Récupération commandes pour: ${user.user_id}`);
    const { orders, pagination } = await this.ordersService.getUserOrders(user.user_id);
    return {
      statusCode: HttpStatus.OK,
      message: `${(orders || []).length} commande(s) récupérée(s) avec succès`,
      data: { orders, pagination },
    };
  }

  @Get('managed-orders')
  @ApiOperation({ 
    summary: 'Obtenir les commandes que je peux gérer (chef/restaurant)',
    description: 'Retourne toutes les commandes du restaurant/chef connecté'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commandes récupérées avec succès',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Accès réservé aux chefs et restaurants',
  })
  async getManagedOrders(
    @CurrentUser() user: any,
  ): Promise<ApiResponse<any>> {
    if (user.role !== 'chef' && user.role !== 'restaurant') {
      throw new ForbiddenException('Seuls les chefs et restaurants peuvent gérer des commandes');
    }
    
    this.logger.log(`🏪 Récupération commandes managées par: ${user.user_id} (${user.role})`);
    
    const orders = await this.ordersService.getRestaurantOrders(user.user_id);
    
    return {
      statusCode: HttpStatus.OK,
      message: `${orders.length} commande(s) à gérer récupérée(s) avec succès`,
      data: { 
        orders, 
        pagination: {
          total: orders.length,
          page: 1,
          limit: orders.length,
          pages: 1
        }
      },
    };
  }

  @Get('stats')
  @ApiOperation({ 
    summary: 'Obtenir les statistiques (chef/restaurant)',
    description: 'Retourne les statistiques détaillées des commandes pour le dashboard restaurant'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Statistiques récupérées avec succès',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Accès réservé aux chefs et restaurants',
  })
  async getStats(
    @CurrentUser() user: any,
  ): Promise<ApiResponse<any>> {
    if (user.role !== 'chef' && user.role !== 'restaurant') {
      throw new ForbiddenException('Seuls les chefs et restaurants peuvent voir les statistiques');
    }

    this.logger.log(`📊 Récupération statistiques pour: ${user.user_id}`);

    const stats = await this.ordersService.getRestaurantStats(user.user_id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Statistiques récupérées avec succès',
      data: {
        ...stats,
        real_time_updates: true,
        websocket_room: `restaurant_${user.user_id}`
      },
    };
  }

  @Get(':orderId')
  @ApiOperation({ 
    summary: 'Obtenir les détails d\'une commande',
    description: 'Retourne les détails complets d\'une commande spécifique'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Détails de la commande récupérés avec succès',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Vous ne pouvez pas voir cette commande',
  })
  async getOrderById(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`🔍 Consultation commande: ${orderId} par: ${user.user_id}`);

    const order = await this.ordersService.getOrderById(orderId);

    const canView = 
      order.user_id.toString() === user.user_id || 
      order.restaurant_id.toString() === user.user_id ||
      user.role === 'chef' || 
      user.role === 'restaurant';

    if (!canView) {
      throw new ForbiddenException('Vous ne pouvez pas voir cette commande');
    }

    return {
      statusCode: HttpStatus.OK,
      message: 'Détails de la commande récupérés avec succès',
      data: {
        ...order.toObject(),
        real_time_tracking: true,
        websocket_events: [
          'order_status_updated',
          'order_preparing', 
          'order_ready',
          'order_cancelled_by_restaurant'
        ]
      },
    };
  }

  @Put(':orderId/status')
  @ApiOperation({ 
    summary: 'Mettre à jour le statut d\'une commande (chef/restaurant)',
    description: 'Met à jour le statut de la commande et notifie le client en temps réel via WebSocket'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Statut de la commande mis à jour avec succès',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Accès réservé aux chefs et restaurants',
  })
  @ApiBody({
    type: UpdateOrderStatusDto,
    examples: {
      preparing: {
        summary: 'Passer en préparation',
        value: {
          status: OrderStatus.PREPARING, // ✅ CORRIGÉ: Utiliser enum
          estimated_preparation_time: 20,
          pickup_instructions: 'Veuillez présenter ce code: ABC123'
        }
      },
      ready: {
        summary: 'Marquer comme prêt',
        value: {
          status: OrderStatus.READY, // ✅ CORRIGÉ: Utiliser enum
          pickup_instructions: 'Commande prête au comptoir'
        }
      },
      cancelled: {
        summary: 'Annuler la commande',
        value: {
          status: OrderStatus.CANCELLED, // ✅ CORRIGÉ: Utiliser enum
          cancellation_reason: 'Ingrédients manquants'
        }
      }
    }
  })
  async updateOrderStatus(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
    @Body() updateOrderStatusDto: UpdateOrderStatusDto,
  ): Promise<ApiResponse<any>> {
    if (user.role !== 'chef' && user.role !== 'restaurant') {
      throw new ForbiddenException('Seuls les chefs et restaurants peuvent modifier le statut des commandes');
    }

    this.logger.log(`🔄 Mise à jour statut commande: ${orderId} par: ${user.user_id}`);
    this.logger.log(`📝 Nouveau statut: ${updateOrderStatusDto.status}`);

    const order = await this.ordersService.updateOrderStatus(
      user.user_id,
      user.role,
      orderId,
      updateOrderStatusDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: this.getStatusUpdateMessage(updateOrderStatusDto.status),
      data: {
        ...order.toObject(),
        notification_sent: true,
        real_time_update: true
      },
    };
  }

  @Put(':orderId/complete')
  @ApiOperation({ 
    summary: 'Marquer une commande comme récupérée (client)',
    description: 'Le client confirme avoir récupéré sa commande'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commande marquée comme récupérée',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'La commande n\'est pas encore prête',
  })
  async completeOrder(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`✅ Marquage comme récupérée: ${orderId} par: ${user.user_id}`);

    const order = await this.ordersService.markOrderAsCompleted(
      user.user_id,
      orderId,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Commande marquée comme récupérée avec succès',
      data: {
        ...order.toObject(),
        completed_at: new Date(),
        notification_sent: true
      },
    };
  }

  @Delete(':orderId/cancel')
  @ApiOperation({ 
    summary: 'Annuler une commande (client)',
    description: 'Le client annule sa commande. Possible seulement si la commande est en attente ou acceptée.'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commande annulée avec succès',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cette commande ne peut plus être annulée',
  })
  @ApiBody({
    type: CancelOrderDto,
    examples: {
      reason1: {
        summary: 'Changement de plans',
        value: {
          reason: 'Changement de plans'
        }
      },
      reason2: {
        summary: 'Temps d\'attente trop long',
        value: {
          reason: 'Temps d\'attente trop long'
        }
      }
    }
  })
  async cancelOrder(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
    @Body() cancelOrderDto: CancelOrderDto,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`❌ Annulation commande: ${orderId} par client: ${user.user_id}`);
    this.logger.log(`📝 Raison: ${cancelOrderDto.reason}`);

    const order = await this.ordersService.cancelOrder(
      user.user_id,
      orderId,
      cancelOrderDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Commande annulée avec succès',
      data: {
        ...order.toObject(),
        refund_eligible: this.isRefundEligible(order),
        notification_sent: true
      },
    };
  }

  @Put(':orderId/cancel-by-restaurant')
  @ApiOperation({ 
    summary: 'Annuler une commande (chef/restaurant)',
    description: 'Le restaurant annule une commande. Possible jusqu\'au statut "preparing". Le client est notifié en temps réel.'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Commande annulée avec succès',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Accès réservé aux chefs et restaurants',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cette commande ne peut plus être annulée',
  })
  @ApiBody({
    type: CancelOrderDto,
    examples: {
      stock: {
        summary: 'Rupture de stock',
        value: {
          reason: 'Rupture de stock des ingrédients'
        }
      },
      technical: {
        summary: 'Problème technique',
        value: {
          reason: 'Problème technique en cuisine'
        }
      }
    }
  })
  async cancelOrderByRestaurant(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
    @Body() cancelOrderDto: CancelOrderDto,
  ): Promise<ApiResponse<any>> {
    if (user.role !== 'chef' && user.role !== 'restaurant') {
      throw new ForbiddenException('Seuls les chefs et restaurants peuvent annuler des commandes');
    }

    this.logger.log(`❌ Annulation commande: ${orderId} par restaurant: ${user.user_id}`);
    this.logger.log(`📝 Raison: ${cancelOrderDto.reason}`);

    const order = await this.ordersService.cancelOrderByRestaurant(
      user.user_id,
      user.role,
      orderId,
      cancelOrderDto,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Commande annulée avec succès. Le client a été notifié.',
      data: {
        ...order.toObject(),
        auto_refund_initiated: true,
        real_time_notification: true
      },
    };
  }

  // ⭐ NOUVEAU ENDPOINT: Tracking temps réel
  @Get(':orderId/tracking')
  @ApiOperation({ 
    summary: 'Obtenir les informations de tracking en temps réel',
    description: 'Retourne les informations de tracking WebSocket pour une commande spécifique'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Informations de tracking récupérées',
  })
  async getOrderTracking(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
  ): Promise<ApiResponse<any>> {
    this.logger.log(`📍 Tracking commande: ${orderId} pour: ${user.user_id}`);

    const order = await this.ordersService.getOrderById(orderId);

    const canView = 
      order.user_id.toString() === user.user_id || 
      order.restaurant_id.toString() === user.user_id;

    if (!canView) {
      throw new ForbiddenException('Vous ne pouvez pas tracker cette commande');
    }

    return {
      statusCode: HttpStatus.OK,
      message: 'Informations de tracking récupérées',
      data: {
        order_id: order.order_id,
        current_status: order.status,
        websocket_config: {
          room: `user_${order.user_id}`,
          events: [
            'order_status_updated',
            'order_preparing',
            'order_ready', 
            'order_cancelled_by_restaurant'
          ],
          endpoint: 'ws://localhost:3000/orders'
        },
        estimated_timeline: this.getEstimatedTimeline(order),
        last_updated: order.updated_at
      },
    };
  }
@Put(':orderId/mark-ready')
@ApiOperation({ summary: 'Marquer la commande comme prête (Restaurant)' })
@ApiParam({ name: 'orderId', type: String })
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Commande marquée comme prête',
})
async markOrderAsReady(
  @CurrentUser() user: any,
  @Param('orderId') orderId: string,
  @Body() body?: { pickup_instructions?: string; estimated_ready_time?: number }
): Promise<any> { // ✅ CORRECTION 1: any au lieu de Order
  const order = await this.ordersService.markOrderAsReady(
    orderId,
    user.user_id,
    body?.pickup_instructions,
    body?.estimated_ready_time
  );

  return {
    statusCode: HttpStatus.OK,
    message: 'Commande marquée comme prête avec succès',
    data: order,
  };
}
  // ⭐ NOUVEAU ENDPOINT: Historique des statuts
  @Get(':orderId/history')
  @ApiOperation({ 
    summary: 'Obtenir l\'historique des statuts d\'une commande',
    description: 'Retourne l\'historique complet des changements de statut d\'une commande'
  })
  @ApiParam({ 
    name: 'orderId', 
    type: String, 
    description: 'ID unique de la commande',
    example: 'uuid-order-123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Historique récupéré avec succès',
  })
  async getOrderHistory(
    @CurrentUser() user: any,
    @Param('orderId') orderId: string,
  ): Promise<ApiResponse<any>> {
    const order = await this.ordersService.getOrderById(orderId);

    const canView = 
      order.user_id.toString() === user.user_id || 
      order.restaurant_id.toString() === user.user_id;

    if (!canView) {
      throw new ForbiddenException('Vous ne pouvez pas voir l\'historique de cette commande');
    }

    const history = this.buildOrderHistory(order);

    return {
      statusCode: HttpStatus.OK,
      message: 'Historique de la commande récupéré avec succès',
      data: {
        order_id: order.order_id,
        history: history,
        total_status_changes: history.length
      },
    };
  }

  // Méthodes utilitaires privées
private getStatusUpdateMessage(status: OrderStatus): string {
  const messages = {
    [OrderStatus.PENDING]: 'Statut mis à jour: En attente',
    [OrderStatus.PENDING_PAYMENT]: 'En attente de confirmation du paiement',
    [OrderStatus.ACCEPTED]: 'Commande acceptée! Le client a été notifié.',
    [OrderStatus.PREPARING]: 'Commande en préparation! Le client a été notifié du temps estimé.',
    [OrderStatus.READY]: 'Commande prête! Le client a été notifié de venir récupérer.',
    [OrderStatus.COMPLETED]: 'Commande marquée comme complétée',
    [OrderStatus.CANCELLED]: 'Commande annulée. Le client a été notifié.'
  };
  return messages[status] || 'Statut mis à jour avec succès';
}

  private isRefundEligible(order: any): boolean {
    // Logique pour déterminer si un remboursement est possible
    const paidStatuses = [OrderStatus.ACCEPTED, OrderStatus.PREPARING]; // ✅ CORRIGÉ: Utiliser enum
    return paidStatuses.includes(order.status) && order.total_price > 0;
  }

private getEstimatedTimeline(order: any) {
  const timelines = {
    [OrderStatus.PENDING]: { next: 'acceptance', estimated: '5-10 min' },
    [OrderStatus.PENDING_PAYMENT]: { next: 'payment_confirmation', estimated: '2-5 min' },
    [OrderStatus.ACCEPTED]: { next: 'preparation', estimated: '2-5 min' },
    [OrderStatus.PREPARING]: { 
      next: 'ready', 
      estimated: order.estimated_preparation_time ? `${order.estimated_preparation_time} min` : '15-25 min' 
    },
    [OrderStatus.READY]: { next: 'completion', estimated: 'En attente de récupération' },
    [OrderStatus.COMPLETED]: { next: 'none', estimated: 'Terminé' },
    [OrderStatus.CANCELLED]: { next: 'none', estimated: 'Annulé' }
  };

  return timelines[order.status] || { next: 'unknown', estimated: 'Indéterminé' };
}

 private buildOrderHistory(order: any) {
  type OrderEvent = { status: string; timestamp: any; description: string };
  const history: OrderEvent[] = [];

  // Statut initial
  history.push({
    status: OrderStatus.PENDING,
    timestamp: order.created_at,
    description: 'Commande créée'
  });

  // Ajouter les timestamps des statuts
  if (order.accepted_at) {
    history.push({
      status: OrderStatus.ACCEPTED,
      timestamp: order.accepted_at,
      description: 'Commande acceptée par le restaurant'
    });
  }

  if (order.preparing_at) {
    history.push({
      status: OrderStatus.PREPARING,
      timestamp: order.preparing_at,
      description: 'Commande en préparation'
    });
  }

  if (order.ready_at) {
    history.push({
      status: OrderStatus.READY,
      timestamp: order.ready_at,
      description: 'Commande prête'
    });
  }

  if (order.completed_at) {
    history.push({
      status: OrderStatus.COMPLETED,
      timestamp: order.completed_at,
      description: 'Commande récupérée par le client'
    });
  }

  if (order.cancelled_at) {
    history.push({
      status: OrderStatus.CANCELLED,
      timestamp: order.cancelled_at,
      description: `Commande annulée: ${order.cancellation_reason}`
    });
  }

  return history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
// ✅ NOUVEAU: Créer un Payment Intent Stripe
@Post(':orderId/create-payment-intent')
@ApiOperation({ 
  summary: 'Créer un Payment Intent Stripe pour une commande',
  description: 'Crée un Payment Intent Stripe pour payer une commande spécifique'
})
@ApiParam({ 
  name: 'orderId', 
  type: String, 
  description: 'ID unique de la commande'
})
async createPaymentIntentForOrder(
  @CurrentUser() user: any,
  @Param('orderId') orderId: string,
): Promise<ApiResponse<any>> {
  // ✅ DEBUG DÉTAILLÉ (comme dans Wallet)
  this.logger.log(`💳 [ORDERS] Création Payment Intent pour commande: ${orderId}`);
  console.log('🔍 [DEBUG] User object:', JSON.stringify(user, null, 2));
  
  const userId = user.userId || user._id || user.user_id || user.sub;
  console.log('👤 [DEBUG] User ID extrait:', userId);

  if (!userId) {
    throw new BadRequestException('User ID manquant');
  }

  try {
    const paymentIntent = await this.ordersService.createPaymentIntent(
      userId,
      orderId
    );

    return {
      statusCode: HttpStatus.CREATED,
      message: 'Payment Intent créé avec succès',
      data: paymentIntent, // ← MÊME FORMAT QUE WALLET
    };

  } catch (error: any) {
    this.logger.error(`❌ [ORDERS] Erreur création Payment Intent: ${error.message}`);
    throw error;
  }
}

// ✅ NOUVEAU: Confirmer le paiement Stripe
@Post(':orderId/confirm-payment')
@ApiOperation({ 
  summary: 'Confirmer le paiement d\'une commande',
  description: 'Marque une commande comme payée après confirmation Stripe'
})
@ApiParam({ 
  name: 'orderId', 
  type: String, 
  description: 'ID unique de la commande'
})
async confirmOrderPayment(
  @CurrentUser() user: any,
  @Param('orderId') orderId: string,
  @Body() body: { payment_intent_id: string },
): Promise<ApiResponse<any>> {
  this.logger.log(`✅ [ORDERS] Confirmation paiement: ${orderId}`);
  this.logger.log(`🎯 Payment Intent ID: ${body.payment_intent_id}`);

  const userId = user.userId || user._id || user.user_id || user.sub;

  if (!userId) {
    throw new BadRequestException('User ID manquant');
  }

  try {
    const order = await this.ordersService.confirmStripePayment(
      userId,
      orderId,
      body.payment_intent_id
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Paiement confirmé avec succès',
      data: {
        ...order.toObject(),
        payment_status: order.payment_status,
        status: order.status,
      },
    };
  } catch (error: any) {
    this.logger.error(`❌ [ORDERS] Erreur confirmation paiement: ${error.message}`);
    throw error;
  }
}
@Post('verify-order-payment')
@ApiOperation({ 
  summary: 'Vérifier un paiement de commande (Webhook)',
  description: 'Endpoint pour webhook Stripe pour vérifier les paiements de commandes'
})
async verifyOrderPaymentWebhook(
  @Body() body: { 
    payment_intent_id: string;
    metadata: any;
  },
): Promise<ApiResponse<any>> {
  this.logger.log(`🔍 [ORDERS] Webhook vérification paiement: ${body.payment_intent_id}`);

  try {
    const order = await this.ordersService.verifyOrderPayment(
      body.payment_intent_id,
      body.metadata
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Paiement vérifié avec succès',
      data: order,
    };
  } catch (error: any) {
    this.logger.error(`❌ [ORDERS] Erreur vérification webhook: ${error.message}`);
    throw error;
  }
}
// ✅ VERSION AMÉLIORÉE AVEC LE DTO

// N'oublie pas d'ajouter en haut du fichier:
// import { AcceptOrderDto } from './dto/accept-order.dto';

@Put(':orderId/accept')
@ApiOperation({ 
  summary: 'Accepter une commande (chef/restaurant)',
  description: 'Le restaurant accepte une nouvelle commande. Le client est notifié immédiatement.'
})
@ApiParam({ 
  name: 'orderId', 
  type: String, 
  description: 'ID unique de la commande',
  example: 'uuid-order-123'
})
@ApiResponse({
  status: HttpStatus.OK,
  description: 'Commande acceptée avec succès',
})
@ApiResponse({
  status: HttpStatus.FORBIDDEN,
  description: 'Accès réservé aux chefs et restaurants',
})
@ApiResponse({
  status: HttpStatus.BAD_REQUEST,
  description: 'Cette commande ne peut pas être acceptée',
})
@ApiBody({
  type: AcceptOrderDto, // ✅ UTILISER LE DTO
  examples: {
    basic: {
      summary: 'Acceptation simple',
      value: {
        estimated_preparation_time: 20
      }
    },
    withNotes: {
      summary: 'Avec notes',
      value: {
        estimated_preparation_time: 25,
        acceptance_notes: 'Commande prioritaire'
      }
    },
    empty: {
      summary: 'Sans détails (acceptation rapide)',
      value: {}
    }
  }
})
async acceptOrder(
  @CurrentUser() user: any,
  @Param('orderId') orderId: string,
  @Body() acceptOrderDto: AcceptOrderDto, // ✅ UTILISER LE DTO
): Promise<ApiResponse<any>> {
  // ✅ VÉRIFIER QUE C'EST UN CHEF/RESTAURANT
  if (user.role !== 'chef' && user.role !== 'restaurant') {
    throw new ForbiddenException('Seuls les chefs et restaurants peuvent accepter des commandes');
  }

  this.logger.log(`✅ Acceptation commande: ${orderId} par: ${user.user_id}`);
  this.logger.log(`📝 Temps estimé: ${acceptOrderDto.estimated_preparation_time || 'non spécifié'} min`);

  try {
    const order = await this.ordersService.acceptOrder(
      user.user_id,
      user.role,
      orderId,
      acceptOrderDto.estimated_preparation_time,
      acceptOrderDto.acceptance_notes
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Commande acceptée avec succès! Le client a été notifié.',
      data: {
        ...order.toObject(),
        notification_sent: true,
        real_time_update: true,
        websocket_event: 'order_accepted'
      },
    };
  } catch (error: any) {
    this.logger.error(`❌ Erreur acceptation commande: ${error.message}`);
    throw error;
  }
}

// ✅ ENDPOINT POUR REJETER UNE COMMANDE (OPTIONNEL)
@Put(':orderId/reject')
@ApiOperation({ 
  summary: 'Rejeter une commande (chef/restaurant)',
  description: 'Le restaurant rejette une commande en attente'
})
@ApiParam({ 
  name: 'orderId', 
  type: String, 
  description: 'ID unique de la commande'
})
@ApiBody({
  type: CancelOrderDto,
  examples: {
    stock: {
      summary: 'Rupture de stock',
      value: {
        reason: 'Rupture de stock des ingrédients principaux'
      }
    },
    closed: {
      summary: 'Restaurant fermé',
      value: {
        reason: 'Restaurant actuellement fermé'
      }
    }
  }
})
async rejectOrder(
  @CurrentUser() user: any,
  @Param('orderId') orderId: string,
  @Body() cancelOrderDto: CancelOrderDto,
): Promise<ApiResponse<any>> {
  if (user.role !== 'chef' && user.role !== 'restaurant') {
    throw new ForbiddenException('Seuls les chefs et restaurants peuvent rejeter des commandes');
  }

  this.logger.log(`❌ Rejet commande: ${orderId} par: ${user.user_id}`);
  this.logger.log(`📝 Raison: ${cancelOrderDto.reason}`);

  const order = await this.ordersService.cancelOrderByRestaurant(
    user.user_id,
    user.role,
    orderId,
    cancelOrderDto
  );

  return {
    statusCode: HttpStatus.OK,
    message: 'Commande rejetée. Le client a été notifié.',
    data: {
      ...order.toObject(),
      rejection_reason: cancelOrderDto.reason,
      notification_sent: true,
      auto_refund_initiated: order.payment_status === PaymentStatus.REFUNDED
    },
  };
}
}