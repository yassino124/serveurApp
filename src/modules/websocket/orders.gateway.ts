// src/modules/websocket/orders.gateway.ts - NOTIFICATIONS TEMPS RÉEL COMPLÈTES
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/orders',
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OrdersGateway.name);
  private connectedUsers: Map<string, string> = new Map(); // userId → socketId

  async handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    
    if (!userId) {
      this.logger.warn(`⚠️ Connexion sans userId`);
      client.disconnect();
      return;
    }

    this.connectedUsers.set(userId, client.id);
    
    // Rejoindre la room personnelle
    client.join(`user_${userId}`);
    
    this.logger.log(`✅ [WS] Client connecté: ${client.id}, User: ${userId}`);
    this.logger.log(`📊 [WS] Total connectés: ${this.connectedUsers.size}`);

    // Confirmer la connexion
    client.emit('connected', {
      message: 'Connecté au serveur de notifications de commandes',
      userId: userId,
      timestamp: new Date().toISOString(),
    });
  }

  async handleDisconnect(client: Socket) {
    const userId = Array.from(this.connectedUsers.entries())
      .find(([, socketId]) => socketId === client.id)?.[0];

    if (userId) {
      this.connectedUsers.delete(userId);
      this.logger.log(`❌ [WS] Client déconnecté: ${client.id}, User: ${userId}`);
    }
  }

  // ========================================
  // 🔔 NOTIFICATIONS RESTAURANT
  // ========================================

  /**
   * ✅ NOUVELLE COMMANDE REÇUE PAR LE RESTAURANT
   */
  notifyNewOrderToRestaurant(order: any) {
    const restaurantId = order.restaurant_id?._id?.toString() || order.restaurant_id?.toString();
    
    this.logger.log(`🔔 [WS] Nouvelle commande → Restaurant ${restaurantId}`);
    
    const notification = {
      type: 'NEW_ORDER',
      order_id: order.order_id,
      customer: {
        user_id: order.user_id?.user_id,
        name: order.user_id?.full_name || order.user_id?.username,
        phone: order.user_id?.phone_number,
      },
      dish: {
        name: order.dish_name,
        quantity: order.quantity,
        total_price: order.total_price,
      },
      payment: {
        method: order.payment_method,
        status: order.payment_status,
      },
      notes: order.customer_notes,
      created_at: order.created_at,
      requires_action: true,
      sound: 'new_order_alert',
    };

    // Émettre vers la room du restaurant
    this.server.to(`user_${restaurantId}`).emit('order:new', notification);
    
    this.logger.log(`📢 [WS] Notification envoyée au restaurant ${restaurantId}`);
  }

  // ========================================
  // 🔔 NOTIFICATIONS CLIENT
  // ========================================

  /**
   * ✅ COMMANDE ACCEPTÉE PAR LE RESTAURANT
   */
  notifyOrderAccepted(order: any) {
    const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
    
    this.logger.log(`🔔 [WS] Commande acceptée → Client ${customerId}`);
    
    const notification = {
      type: 'ORDER_ACCEPTED',
      order_id: order.order_id,
      restaurant: {
        name: order.restaurant_id?.full_name || order.restaurant_id?.username,
        phone: order.restaurant_id?.phone_number,
      },
      estimated_time: order.estimated_preparation_time,
      message: `Votre commande a été acceptée ! Préparation estimée: ${order.estimated_preparation_time || 20} minutes`,
      status: order.status,
      accepted_at: order.accepted_at,
      sound: 'order_accepted',
    };

    this.server.to(`user_${customerId}`).emit('order:accepted', notification);
    
    this.logger.log(`📢 [WS] Notification acceptation envoyée à ${customerId}`);
  }

  /**
   * ✅ COMMANDE EN PRÉPARATION
   */
  notifyOrderPreparing(order: any, estimatedTime: number) {
    const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
    
    this.logger.log(`🔔 [WS] Commande en préparation → Client ${customerId}`);
    
    const notification = {
      type: 'ORDER_PREPARING',
      order_id: order.order_id,
      message: `Votre commande est en cours de préparation ! Elle sera prête dans environ ${estimatedTime} minutes.`,
      estimated_ready_time: new Date(Date.now() + estimatedTime * 60000).toISOString(),
      status: order.status,
      preparing_at: order.preparing_at,
      progress: {
        current: 'preparing',
        next: 'ready',
        percentage: 50,
      },
      sound: 'order_preparing',
    };

    this.server.to(`user_${customerId}`).emit('order:preparing', notification);
    
    this.logger.log(`📢 [WS] Notification préparation envoyée à ${customerId}`);
  }

  /**
   * ✅ COMMANDE PRÊTE
   */
  notifyOrderReady(order: any) {
    const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
    
    this.logger.log(`🔔 [WS] Commande prête → Client ${customerId}`);
    
    const notification = {
      type: 'ORDER_READY',
      order_id: order.order_id,
      message: `🎉 Votre commande est prête ! Venez la récupérer.`,
      pickup_instructions: order.pickup_instructions,
      restaurant: {
        name: order.restaurant_id?.full_name || order.restaurant_id?.username,
        phone: order.restaurant_id?.phone_number,
      },
      status: order.status,
      ready_at: order.ready_at,
      progress: {
        current: 'ready',
        next: 'completed',
        percentage: 90,
      },
      requires_action: true,
      sound: 'order_ready_urgent',
    };

    this.server.to(`user_${customerId}`).emit('order:ready', notification);
    
    this.logger.log(`📢 [WS] Notification prête envoyée à ${customerId}`);
  }

  /**
   * ✅ COMMANDE ANNULÉE
   */
  notifyOrderCancelled(order: any, cancelledBy: 'customer' | 'restaurant') {
    const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
    const restaurantId = order.restaurant_id?._id?.toString() || order.restaurant_id?.toString();
    
    this.logger.log(`🔔 [WS] Commande annulée par ${cancelledBy} → Order ${order.order_id}`);
    
    const notificationToCustomer = {
      type: 'ORDER_CANCELLED',
      order_id: order.order_id,
      cancelled_by: cancelledBy,
      reason: order.cancellation_reason,
      message: cancelledBy === 'restaurant' 
        ? `Le restaurant a annulé votre commande. Raison: ${order.cancellation_reason}`
        : `Votre commande a été annulée avec succès.`,
      refund_info: order.payment_status === 'refunded' 
        ? 'Un remboursement a été effectué sur votre wallet.'
        : null,
      status: order.status,
      cancelled_at: order.cancelled_at,
      sound: 'order_cancelled',
    };

    const notificationToRestaurant = {
      type: 'ORDER_CANCELLED',
      order_id: order.order_id,
      cancelled_by: cancelledBy,
      reason: order.cancellation_reason,
      message: `Le client a annulé la commande. Raison: ${order.cancellation_reason}`,
      customer: {
        name: order.user_id?.full_name || order.user_id?.username,
      },
      status: order.status,
      cancelled_at: order.cancelled_at,
    };

    // Notifier le client
    this.server.to(`user_${customerId}`).emit('order:cancelled', notificationToCustomer);
    
    // Notifier le restaurant si annulé par le client
    if (cancelledBy === 'customer') {
      this.server.to(`user_${restaurantId}`).emit('order:cancelled', notificationToRestaurant);
    }
    
    this.logger.log(`📢 [WS] Notifications annulation envoyées`);
  }

  /**
   * ✅ MISE À JOUR GÉNÉRALE DE STATUT
   */
  notifyOrderStatusUpdate(order: any) {
    const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
    const restaurantId = order.restaurant_id?._id?.toString() || order.restaurant_id?.toString();
    
    this.logger.log(`🔔 [WS] Mise à jour statut → Order ${order.order_id}: ${order.status}`);
    
    const notification = {
      type: 'ORDER_STATUS_UPDATE',
      order_id: order.order_id,
      status: order.status,
      payment_status: order.payment_status,
      updated_at: order.updated_at,
      message: this.getStatusMessage(order.status),
    };

    // Notifier le client
    this.server.to(`user_${customerId}`).emit('order:status_update', notification);
    
    // Notifier le restaurant
    this.server.to(`user_${restaurantId}`).emit('order:status_update', notification);
    
    this.logger.log(`📢 [WS] Mise à jour statut envoyée`);
  }

  /**
   * ✅ PAIEMENT CONFIRMÉ
   */
  notifyPaymentConfirmed(order: any) {
    const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
    const restaurantId = order.restaurant_id?._id?.toString() || order.restaurant_id?.toString();
    
    this.logger.log(`🔔 [WS] Paiement confirmé → Order ${order.order_id}`);
    
    const notificationToCustomer = {
      type: 'PAYMENT_CONFIRMED',
      order_id: order.order_id,
      message: '✅ Paiement confirmé ! Votre commande est en attente d\'acceptation par le restaurant.',
      amount: order.total_price,
      payment_method: order.payment_method,
      status: order.status,
    };

    const notificationToRestaurant = {
      type: 'PAYMENT_CONFIRMED',
      order_id: order.order_id,
      message: '💰 Paiement confirmé pour cette commande.',
      amount: order.total_price,
      requires_action: true,
    };

    this.server.to(`user_${customerId}`).emit('order:payment_confirmed', notificationToCustomer);
    this.server.to(`user_${restaurantId}`).emit('order:payment_confirmed', notificationToRestaurant);
    
    this.logger.log(`📢 [WS] Notifications paiement envoyées`);
  }

  // ========================================
  // 🛠️ MÉTHODES UTILITAIRES
  // ========================================

  private getStatusMessage(status: string): string {
    const messages: Record<string, string> = {
      'pending': 'En attente d\'acceptation',
      'pending_payment': 'En attente de paiement',
      'accepted': 'Commande acceptée',
      'preparing': 'En cours de préparation',
      'ready': 'Prête à être récupérée',
      'completed': 'Commande récupérée',
      'cancelled': 'Commande annulée',
    };
    
    return messages[status] || 'Statut mis à jour';
  }

  /**
   * ✅ VÉRIFIER SI UN UTILISATEUR EST CONNECTÉ
   */
  isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * ✅ OBTENIR LE NOMBRE D'UTILISATEURS CONNECTÉS
   */
  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }
  /**
 * ✅ COMMANDE APPROUVÉE PAR LE RESTAURANT
 */
notifyOrderApproved(order: any) {
  const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
  const restaurantName = order.restaurant_id?.full_name || order.restaurant_id?.username || 'Le restaurant';
  
  this.logger.log(`🔔 [WS] Commande approuvée → Client ${customerId}`);
  
  const notification = {
    type: 'ORDER_APPROVED',
    order_id: order.order_id,
    restaurant: {
      name: restaurantName,
      phone: order.restaurant_id?.phone_number,
    },
    estimated_time: order.estimated_preparation_time,
    message: `✅ ${restaurantName} a approuvé votre commande !\nPréparation estimée: ${order.estimated_preparation_time || 15} minutes.`,
    status: 'approved',
    approved_at: new Date().toISOString(),
    estimated_ready_time: new Date(Date.now() + (order.estimated_preparation_time || 15) * 60000).toISOString(),
    sound: 'order_approved',
    requires_action: false,
  };

  this.server.to(`user_${customerId}`).emit('order:approved', notification);
  
  this.logger.log(`📢 [WS] Notification approbation envoyée à ${customerId}`);
}

/**
 * ✅ COMMANDE REJETÉE PAR LE RESTAURANT
 */
notifyOrderRejected(order: any, rejectionReason: string) {
  const customerId = order.user_id?._id?.toString() || order.user_id?.toString();
  const restaurantName = order.restaurant_id?.full_name || order.restaurant_id?.username || 'Le restaurant';
  
  this.logger.log(`🔔 [WS] Commande rejetée → Client ${customerId}`);
  
  const notification = {
    type: 'ORDER_REJECTED',
    order_id: order.order_id,
    restaurant: {
      name: restaurantName,
    },
    message: `❌ ${restaurantName} ne peut pas honorer votre commande.\n\nRaison: ${rejectionReason}`,
    rejection_reason: rejectionReason,
    refund_info: 'Votre paiement sera remboursé dans les 24 heures.',
    status: 'rejected',
    rejected_at: new Date().toISOString(),
    sound: 'order_rejected',
    requires_action: true,
  };

  this.server.to(`user_${customerId}`).emit('order:rejected', notification);
  
  this.logger.log(`📢 [WS] Notification rejet envoyée à ${customerId}`);
}
}