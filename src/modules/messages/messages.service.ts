import { 
  Injectable, 
  Logger, 
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument, MessageType } from './message.schema';
import { OrderDocument, OrderStatus } from '../orders/order.schema';
import { v4 as uuidv4 } from 'uuid'; // ✅ AJOUTER CET IMPORT
import { OrdersService } from '../orders/orders.service'; // ✅ AJOUTER CET IMPORT

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @Inject(forwardRef(() => OrdersService)) // ✅ CORRECTION ICI
    private ordersService: OrdersService,
    ) {}

  // ✅ Créer un message avec gestion d'erreur
  async createMessage(
    recipientId: string,
    messageType: MessageType,
    title: string,
    content: string,
    senderId?: string,
    orderId?: string,
    metadata?: Record<string, any>,
  ): Promise<MessageDocument> {
    try {
      // Validation des IDs
      if (!Types.ObjectId.isValid(recipientId)) {
        throw new Error(`ID de destinataire invalide: ${recipientId}`);
      }

      if (senderId && !Types.ObjectId.isValid(senderId)) {
        throw new Error(`ID d'expéditeur invalide: ${senderId}`);
      }

      if (orderId && !Types.ObjectId.isValid(orderId)) {
        throw new Error(`ID de commande invalide: ${orderId}`);
      }

      const messageData: any = {
        recipient_id: new Types.ObjectId(recipientId),
        message_type: messageType,
        title,
        content,
        metadata: metadata || {},
      };

      // Ajouter les champs optionnels seulement s'ils sont fournis
      if (senderId) {
        messageData.sender_id = new Types.ObjectId(senderId);
      }

      if (orderId) {
        messageData.order_id = new Types.ObjectId(orderId);
      }

      const message = await this.messageModel.create(messageData);

      this.logger.log(`📨 Message créé pour: ${recipientId}, type: ${messageType}`);
      this.logger.debug(`Message ID: ${message.message_id}`);

      return message;
    } catch (error) {
      this.logger.error(`❌ Erreur création message: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Erreur lors de la création du message');
    }
  }

  // ✅ Notifier nouvelle commande au restaurant avec sécurité
  async notifyNewOrderToRestaurant(order: OrderDocument): Promise<MessageDocument> {
    try {
      // Vérification des données
      if (!order.restaurant_id || !order.user_id) {
        throw new Error('Données de commande incomplètes');
      }

      const restaurantId = this.getObjectId(order.restaurant_id);
      const customerName = this.getUserFullName(order.user_id);
      const customerId = this.getObjectId(order.user_id);
      const orderId = this.getOrderId(order); // ✅ CORRIGÉ

      return await this.createMessage(
        restaurantId,
        MessageType.ORDER_CREATED,
        'Nouvelle commande reçue! 🎉',
        `Vous avez une nouvelle commande de ${customerName} pour "${order.dish_name}" x ${order.quantity}.`,
        customerId,
        orderId,
        {
          dish_name: order.dish_name,
          quantity: order.quantity,
          customer_name: customerName,
          order_id: order.order_id,
        },
      );
    } catch (error) {
      this.logger.error(`❌ Erreur notification nouvelle commande: ${error.message}`);
      throw error;
    }
  }

  // ✅ Notifier mise à jour statut au client
  async notifyOrderStatusToCustomer(order: OrderDocument): Promise<MessageDocument> {
    try {
      if (!order.user_id || !order.restaurant_id) {
        throw new Error('Données de commande incomplètes');
      }

      const customerId = this.getObjectId(order.user_id);
      const restaurantName = this.getUserFullName(order.restaurant_id);
      const restaurantId = this.getObjectId(order.restaurant_id);
      const orderId = this.getOrderId(order); // ✅ CORRIGÉ

      let statusMessage = '';
      let title = 'Mise à jour de votre commande';

      switch (order.status) {
        case OrderStatus.ACCEPTED:
          statusMessage = 'a accepté votre commande';
          title = 'Commande acceptée! ✅';
          break;
        case OrderStatus.PREPARING:
          statusMessage = 'est en train de préparer votre commande';
          title = 'Votre commande est en préparation 👨‍🍳';
          break;
        case OrderStatus.READY:
          statusMessage = 'a terminé votre commande';
          title = 'Votre commande est prête! 🎉';
          break;
        case OrderStatus.COMPLETED:
          statusMessage = 'a confirmé la récupération de votre commande';
          title = 'Commande terminée ✅';
          break;
        case OrderStatus.CANCELLED:
          statusMessage = 'a annulé votre commande';
          title = 'Commande annulée ❌';
          break;
        default:
          statusMessage = 'a mis à jour le statut de votre commande';
      }

      // Ajouter des informations supplémentaires si disponibles
      let additionalInfo = '';
      if (order.estimated_preparation_time && order.status === OrderStatus.ACCEPTED) {
        additionalInfo = `\nTemps de préparation estimé: ${order.estimated_preparation_time} minutes`;
      }
      
      if (order.pickup_instructions && order.status === OrderStatus.READY) {
        additionalInfo = `\nInstructions: ${order.pickup_instructions}`;
      }

      return await this.createMessage(
        customerId,
        MessageType.ORDER_STATUS_UPDATED,
        title,
        `${restaurantName} ${statusMessage}: "${order.dish_name}" x ${order.quantity}.${additionalInfo}`,
        restaurantId,
        orderId,
        {
          dish_name: order.dish_name,
          quantity: order.quantity,
          restaurant_name: restaurantName,
          new_status: order.status,
          estimated_preparation_time: order.estimated_preparation_time,
          pickup_instructions: order.pickup_instructions,
          order_id: order.order_id,
        },
      );
    } catch (error) {
      this.logger.error(`❌ Erreur notification statut commande: ${error.message}`);
      throw error;
    }
  }

  // ✅ Notifier annulation au restaurant
  async notifyRestaurantOrderCancellation(order: OrderDocument): Promise<MessageDocument> {
    try {
      if (!order.restaurant_id || !order.user_id) {
        throw new Error('Données de commande incomplètes');
      }

      const restaurantId = this.getObjectId(order.restaurant_id);
      const customerName = this.getUserFullName(order.user_id);
      const customerId = this.getObjectId(order.user_id);
      const orderId = this.getOrderId(order); // ✅ CORRIGÉ

      const cancellationReason = order.cancellation_reason || 'Aucune raison spécifiée';

      return await this.createMessage(
        restaurantId,
        MessageType.ORDER_CANCELLED,
        'Commande annulée ❌',
        `${customerName} a annulé sa commande pour "${order.dish_name}".\nRaison: ${cancellationReason}`,
        customerId,
        orderId,
        {
          dish_name: order.dish_name,
          quantity: order.quantity,
          customer_name: customerName,
          cancellation_reason: cancellationReason,
          order_id: order.order_id,
        },
      );
    } catch (error) {
      this.logger.error(`❌ Erreur notification annulation: ${error.message}`);
      throw error;
    }
  }

  // ✅ Notifier commande complétée au restaurant
  async notifyOrderCompletedToRestaurant(order: OrderDocument): Promise<MessageDocument> {
    try {
      if (!order.restaurant_id || !order.user_id) {
        throw new Error('Données de commande incomplètes');
      }

      const restaurantId = this.getObjectId(order.restaurant_id);
      const customerName = this.getUserFullName(order.user_id);
      const customerId = this.getObjectId(order.user_id);
      const orderId = this.getOrderId(order); // ✅ CORRIGÉ

      return await this.createMessage(
        restaurantId,
        MessageType.ORDER_COMPLETED,
        'Commande récupérée ✅',
        `${customerName} a récupéré sa commande: "${order.dish_name}" x ${order.quantity}.`,
        customerId,
        orderId,
        {
          dish_name: order.dish_name,
          quantity: order.quantity,
          customer_name: customerName,
          order_id: order.order_id,
        },
      );
    } catch (error) {
      this.logger.error(`❌ Erreur notification commande complétée: ${error.message}`);
      throw error;
    }
  }

  // ✅ Récupérer les messages d'un utilisateur avec pagination
  async getUserMessages(userId: string, page: number = 1, limit: number = 20) {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new Error('ID utilisateur invalide');
      }

      const skip = (page - 1) * limit;
      const validLimit = Math.min(Math.max(1, limit), 100); // Limiter à 100 max

      const [messages, total] = await Promise.all([
        this.messageModel
          .find({ recipient_id: new Types.ObjectId(userId) })
          .populate('sender_id', 'user_id username full_name profile_picture')
          .populate('order_id', 'order_id dish_name quantity status')
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(validLimit)
          .exec(),
        this.messageModel.countDocuments({
          recipient_id: new Types.ObjectId(userId),
        }),
      ]);

      return {
        messages,
        pagination: {
          page,
          limit: validLimit,
          total,
          pages: Math.ceil(total / validLimit),
          has_more: skip + messages.length < total,
        },
      };
    } catch (error) {
      this.logger.error(`❌ Erreur récupération messages: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la récupération des messages');
    }
  }

  // ✅ Marquer un message comme lu
  async markAsRead(messageId: string, userId: string): Promise<MessageDocument | null> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new Error('ID utilisateur invalide');
      }

      const message = await this.messageModel
        .findOneAndUpdate(
          {
            message_id: messageId,
            recipient_id: new Types.ObjectId(userId),
          },
          {
            $set: {
              is_read: true,
              read_at: new Date(),
            },
          },
          { new: true }
        )
        .populate('sender_id', 'user_id username full_name profile_picture')
        .populate('order_id', 'order_id dish_name quantity status')
        .exec();

      if (message) {
        this.logger.log(`✅ Message marqué comme lu: ${messageId}`);
      }

      return message;
    } catch (error) {
      this.logger.error(`❌ Erreur marquage message comme lu: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors du marquage du message');
    }
  }

  // ✅ Marquer tous les messages comme lus
  async markAllAsRead(userId: string): Promise<{ modified_count: number }> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new Error('ID utilisateur invalide');
      }

      const result = await this.messageModel
        .updateMany(
          {
            recipient_id: new Types.ObjectId(userId),
            is_read: false,
          },
          {
            $set: {
              is_read: true,
              read_at: new Date(),
            },
          }
        )
        .exec();

      this.logger.log(`✅ ${result.modifiedCount} messages marqués comme lus pour l'utilisateur: ${userId}`);

      return { modified_count: result.modifiedCount };
    } catch (error) {
      this.logger.error(`❌ Erreur marquage tous messages comme lus: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors du marquage des messages');
    }
  }

  // ✅ Compter les messages non lus
  async getUnreadCount(userId: string): Promise<{ unread_count: number }> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new Error('ID utilisateur invalide');
      }

      const count = await this.messageModel.countDocuments({
        recipient_id: new Types.ObjectId(userId),
        is_read: false,
      });

      return { unread_count: count };
    } catch (error) {
      this.logger.error(`❌ Erreur comptage messages non lus: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors du comptage des messages');
    }
  }

  // ✅ Supprimer un message
  async deleteMessage(messageId: string, userId: string): Promise<{ deleted_count: number }> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new Error('ID utilisateur invalide');
      }

      const result = await this.messageModel
        .deleteOne({
          message_id: messageId,
          recipient_id: new Types.ObjectId(userId),
        })
        .exec();

      this.logger.log(`🗑️ Message supprimé: ${messageId}, résultat: ${result.deletedCount}`);

      return { deleted_count: result.deletedCount };
    } catch (error) {
      this.logger.error(`❌ Erreur suppression message: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la suppression du message');
    }
  }

  // ✅ Méthodes utilitaires privées
  private getObjectId(id: any): string {
    if (typeof id === 'string') return id;
    if (id && id._id) return id._id.toString();
    if (id && id.toString) return id.toString();
    throw new Error(`Impossible d'extraire l'ID: ${id}`);
  }

  private getUserFullName(user: any): string {
    if (!user) return 'Utilisateur inconnu';
    if (typeof user === 'string') return user;
    if (user.full_name) return user.full_name;
    if (user.username) return user.username;
    return 'Utilisateur inconnu';
  }

  // ✅ NOUVELLE MÉTHODE : Extraire l'ID de commande de manière sécurisée
  private getOrderId(order: OrderDocument): string {
    // Essayer d'abord avec _id (MongoDB ObjectId)
    if (order._id && order._id.toString) {
      return order._id.toString();
    }
    
    // Sinon utiliser order_id (UUID)
    if (order.order_id) {
      return order.order_id;
    }
    
    // En dernier recours, essayer d'accéder à l'ID via d'autres méthodes
    const orderAny = order as any;
    if (orderAny.id) {
      return orderAny.id.toString();
    }
    
    throw new Error('Impossible de récupérer l\'ID de la commande');
  }

  // ✅ Notifier approbation de commande au client
  async notifyOrderApprovalToCustomer(order: OrderDocument): Promise<MessageDocument> {
    try {
      if (!order.user_id || !order.restaurant_id) {
        throw new Error('Données de commande incomplètes');
      }

      const customerId = this.getObjectId(order.user_id);
      const restaurantName = this.getUserFullName(order.restaurant_id);
      const restaurantId = this.getObjectId(order.restaurant_id);
      const orderId = this.getOrderId(order);

      return await this.createMessage(
        customerId,
        MessageType.ORDER_STATUS_UPDATED,
        'Commande approuvée! ✅',
        `${restaurantName} a approuvé votre commande: "${order.dish_name}" x ${order.quantity}.\nPréparation estimée: ${order.estimated_preparation_time || 15} minutes.\n\nVous serez notifié lorsque votre commande sera prête.`,
        restaurantId,
        orderId,
        {
          dish_name: order.dish_name,
          quantity: order.quantity,
          restaurant_name: restaurantName,
          new_status: OrderStatus.ACCEPTED,
          estimated_preparation_time: order.estimated_preparation_time,
          order_id: order.order_id,
          is_approved: true,
        },
      );
    } catch (error) {
      this.logger.error(`❌ Erreur notification approbation commande: ${error.message}`);
      throw error;
    }
  }

  // ✅ Notifier rejet de commande au client
  async notifyOrderRejectionToCustomer(order: OrderDocument, rejectionReason?: string): Promise<MessageDocument> {
    try {
      if (!order.user_id || !order.restaurant_id) {
        throw new Error('Données de commande incomplètes');
      }

      const customerId = this.getObjectId(order.user_id);
      const restaurantName = this.getUserFullName(order.restaurant_id);
      const restaurantId = this.getObjectId(order.restaurant_id);
      const orderId = this.getOrderId(order);

      const reason = rejectionReason || 'Non spécifié';

      return await this.createMessage(
        customerId,
        MessageType.ORDER_CANCELLED,
        'Commande rejetée ❌',
        `${restaurantName} ne peut pas honorer votre commande.\n\nRaison: ${reason}\n\nVotre paiement sera remboursé dans les 24 heures.`,
        restaurantId,
        orderId,
        {
          dish_name: order.dish_name,
          quantity: order.quantity,
          restaurant_name: restaurantName,
          rejection_reason: reason,
          order_id: order.order_id,
          refund_expected: true,
        },
      );
    } catch (error) {
      this.logger.error(`❌ Erreur notification rejet commande: ${error.message}`);
      throw error;
    }
  }

  // ✅ Créer un message de commande avec boutons d'action (NOM MODIFIÉ POUR ÉVITER LE DUPLICAT)
  async createOrderActionMessage(
    recipientId: string,
    senderId: string,
    orderId: string,
    title: string,
    content: string,
    metadata: any = {},
    messageType: string = 'order_status_updated'
  ): Promise<MessageDocument> {
    const message = await this.messageModel.create({
      message_id: uuidv4(),
      recipient_id: recipientId,
      sender_id: senderId,
      order_id: orderId,
      message_type: messageType,
      title,
      content,
      metadata: {
        ...metadata,
        order_id: orderId,
        has_action_buttons: true,
        actions: [
          {
            type: 'accept',
            label: '✅ Approuver la commande',
            endpoint: `/orders/${orderId}/accept`,
            method: 'PUT',
            style: 'success'
          },
          {
            type: 'reject',
            label: '❌ Rejeter la commande',
            endpoint: `/orders/${orderId}/reject`,
            method: 'PUT',
            style: 'danger'
          }
        ]
      },
      is_read: false,
    });

    this.logger.log(`📨 Message créé: ${message.message_id}`);
    return message;
  }

  /**
   * ✅ CRÉER NOTIFICATION POUR NOUVELLE COMMANDE AVEC BOUTONS (RESTAURANT) - NOM MODIFIÉ
   */
  async notifyNewOrderWithActions(order: any): Promise<MessageDocument> {
    const restaurantId = order.restaurant_id?.toString();
    const customerName = order.user_id?.full_name || order.user_id?.username || 'Client';
    
    const message = await this.createOrderActionMessage(
      restaurantId,
      order.user_id?.toString(),
      order._id,
      '📦 Nouvelle Commande',
      `Vous avez reçu une nouvelle commande de ${customerName}\n\n` +
      `🍽️ Plat: ${order.dish_name}\n` +
      `🔢 Quantité: ${order.quantity}\n` +
      `💰 Montant: ${order.total_price} TND\n\n` +
      `Veuillez approuver ou rejeter cette commande.`,
      {
        order_status: order.status,
        dish_name: order.dish_name,
        quantity: order.quantity,
        total_price: order.total_price,
        customer_name: customerName,
        requires_action: true,
        action_required: true,
        order_actions_enabled: true
      },
      'order_created'
    );

    return message;
  }

  /**
   * ✅ CRÉER NOTIFICATION POUR LE CLIENT (COMMANDE APPROUVÉE) - NOM MODIFIÉ
   */
  async sendOrderApprovedNotification(order: any): Promise<MessageDocument> {
    const customerId = order.user_id?.toString();
    const restaurantName = order.restaurant_id?.full_name || order.restaurant_id?.username || 'Restaurant';
    
    const message = await this.messageModel.create({
      message_id: uuidv4(),
      recipient_id: customerId,
      sender_id: order.restaurant_id?.toString(),
      order_id: order._id,
      message_type: 'order_approved',
      title: '✅ Commande Approuvée',
      content: `${restaurantName} a approuvé votre commande !\n\n` +
               `🍽️ Votre ${order.dish_name} est en cours de préparation.\n` +
               `⏱️ Temps estimé: ${order.estimated_preparation_time || 15} minutes\n\n` +
               `Préparez-vous à récupérer votre commande !`,
      metadata: {
        order_id: order.order_id,
        restaurant_name: restaurantName,
        estimated_preparation_time: order.estimated_preparation_time,
        status: 'approved',
        is_good_news: true,
        show_tracking_button: true,
        tracking_url: `/orders/${order.order_id}/tracking`
      },
      is_read: false,
    });

    this.logger.log(`📨 Notification approbation envoyée à ${customerId}`);
    return message;
  }

  /**
   * ✅ GÉRER LES ACTIONS DE MESSAGE (Boutons)
   */
  async handleMessageAction(messageId: string, action: string, userId: string): Promise<any> {
    const message = await this.messageModel.findById(messageId);
    
    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier que l'utilisateur est le destinataire
    if (message.recipient_id.toString() !== userId) {
      throw new ForbiddenException('Vous ne pouvez pas effectuer cette action');
    }

    // Traiter l'action selon le type
    switch (action) {
      case 'accept':
        // Appeler le service orders pour accepter
        const order = await this.ordersService.acceptOrder(
          userId,
          'restaurant', // role
          message.metadata?.order_id,
          message.metadata?.estimated_preparation_time
        );
        
        // Marquer le message comme traité
        await this.messageModel.findByIdAndUpdate(messageId, {
          $set: {
            'metadata.action_completed': true,
            'metadata.action_taken': 'accepted',
            'metadata.action_taken_at': new Date()
          }
        });
        
        return { success: true, order };
        
      case 'reject':
        // Appeler le service orders pour rejeter
        const cancelledOrder = await this.ordersService.cancelOrderByRestaurant(
          userId,
          'restaurant',
          message.metadata?.order_id,
          { reason: 'Rejeté via notification' }
        );
        
        await this.messageModel.findByIdAndUpdate(messageId, {
          $set: {
            'metadata.action_completed': true,
            'metadata.action_taken': 'rejected',
            'metadata.action_taken_at': new Date()
          }
        });
        
        return { success: true, order: cancelledOrder };
        
      default:
        throw new BadRequestException('Action non supportée');
    }
  }
  async notifyOrderReadyToCustomer(order: OrderDocument): Promise<MessageDocument> {
  try {
    if (!order.user_id || !order.restaurant_id) {
      throw new Error('Données de commande incomplètes');
    }

    const customerId = this.getObjectId(order.user_id);
    const restaurantName = this.getUserFullName(order.restaurant_id);
    const restaurantId = this.getObjectId(order.restaurant_id);
    const orderId = this.getOrderId(order);

    return await this.createMessage(
      customerId,
      MessageType.ORDER_STATUS_UPDATED,
      '🎉 Commande Prête!',
      `${restaurantName} a terminé votre commande: "${order.dish_name}" x ${order.quantity}.\n\n` +
      `🎒 Votre commande est prête à être récupérée!\n\n` +
      `${order.pickup_instructions ? `📍 Instructions: ${order.pickup_instructions}\n\n` : ''}` +
      `Venez la récupérer dès maintenant! 🚀`,
      restaurantId,
      orderId,
      {
        dish_name: order.dish_name,
        quantity: order.quantity,
        restaurant_name: restaurantName,
        new_status: OrderStatus.READY,
        pickup_instructions: order.pickup_instructions,
        order_id: order.order_id,
        is_ready: true,
        ready_at: order.ready_at,
      },
    );
  } catch (error) {
    this.logger.error(`❌ Erreur notification commande prête: ${error.message}`);
    throw error;
  }
}
}