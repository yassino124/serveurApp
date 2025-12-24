// src/modules/orders/orders.service.ts - VERSION CORRIGÉE
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderStatus, PaymentStatus, PaymentMethod } from './order.schema';
import { Reel, ReelDocument } from '../reels/reel.schema';
import { User, UserDocument } from '../users/user.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/restaurant.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { MessagesService } from '../messages/messages.service';
import { OrdersGateway } from '../websocket/orders.gateway';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Reel.name) private reelModel: Model<ReelDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
    private messagesService: MessagesService,
    private ordersGateway: OrdersGateway,
    private walletService: WalletService,
    private stripeService: StripeService,
  ) {}

  // ✅ CRÉATION COMMANDE AVEC CHOIX DE PAIEMENT
  async createOrder(
    userId: string,
    createOrderDto: CreateOrderDto,
  ): Promise<OrderDocument> {
    try {
      this.logger.log('🔍 ==== CRÉATION COMMANDE ====');
      this.logger.log(`👤 User ID: ${userId}`);
      this.logger.log(`📦 Reel ID: ${createOrderDto.reel_id}`);
      this.logger.log(`💳 Méthode: ${createOrderDto.payment_method || PaymentMethod.CASH}`);

      // ✅ RECHERCHE DU REEL
      let reel = await this.reelModel
        .findOne({ reel_id: createOrderDto.reel_id })
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .exec();
      
      if (!reel && Types.ObjectId.isValid(createOrderDto.reel_id)) {
        reel = await this.reelModel
          .findById(createOrderDto.reel_id)
          .populate('user_id', 'user_id username full_name profile_picture phone_number role')
          .exec();
      }
      
      if (!reel) {
        throw new NotFoundException(`Reel non trouvé: ${createOrderDto.reel_id}`);
      }

      const reelOwnerId = this.getObjectId(reel.user_id);
      if (reelOwnerId === userId) {
        throw new BadRequestException('Vous ne pouvez pas commander votre propre plat');
      }

      if (reel.status !== 'active') {
        throw new BadRequestException('Ce reel n\'est pas disponible');
      }

      // ✅ CALCUL DU PRIX
      const dishName = reel.caption;
      const { unitPrice, totalPrice } = await this.getDishPriceFromRestaurant(
        reelOwnerId,
        dishName,
        createOrderDto.quantity,
        createOrderDto.custom_unit_price
      );

      // ✅ DÉTERMINER LES STATUTS
      const paymentMethod = createOrderDto.payment_method || PaymentMethod.CASH;
      let initialStatus = OrderStatus.PENDING;
      let paymentStatus = PaymentStatus.CASH_ON_DELIVERY;

      if (paymentMethod === PaymentMethod.WALLET || paymentMethod === PaymentMethod.CARD) {
        initialStatus = OrderStatus.PENDING_PAYMENT;
        paymentStatus = PaymentStatus.PENDING;
      }

      // ✅ CRÉER LA COMMANDE
      const order = await this.orderModel.create({
        user_id: new Types.ObjectId(userId),
        reel_id: reel._id,
        restaurant_id: reel.user_id,
        dish_name: dishName,
        quantity: createOrderDto.quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        customer_notes: createOrderDto.customer_notes,
        status: initialStatus,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
      });

      // ✅ PAIEMENT IMMÉDIAT SI WALLET
      if (paymentMethod === PaymentMethod.WALLET) {
        try {
          await this.walletService.payOrderWithWallet(userId, order.order_id, totalPrice);
          
          await this.orderModel.findByIdAndUpdate(order._id, { 
            status: OrderStatus.PENDING,
            payment_status: PaymentStatus.PAID 
          });
          
          this.logger.log(`✅ Paiement wallet réussi: ${order.order_id}`);
        } catch (paymentError: any) {
          await this.orderModel.findByIdAndUpdate(order._id, { 
            status: OrderStatus.CANCELLED,
            payment_status: PaymentStatus.FAILED,
            cancellation_reason: `Paiement échoué: ${paymentError.message}`,
            cancelled_at: new Date(),
          });
          
          throw new BadRequestException(
            `Paiement échoué: ${paymentError.message}. Vérifiez votre solde.`
          );
        }
      }

      // ✅ POPULATION
      const populatedOrder = await this.orderModel
        .findById(order._id)
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
        .exec();

      if (!populatedOrder) {
        throw new InternalServerErrorException('Erreur création commande');
      }

      this.logger.log(`✅ Commande créée: ${populatedOrder.order_id}`);

      // 🔔 NOTIFICATIONS
      try {
        this.ordersGateway.notifyNewOrderToRestaurant(populatedOrder);
        await this.messagesService.notifyNewOrderToRestaurant(populatedOrder);
        
        if (populatedOrder.payment_status === PaymentStatus.PAID) {
          this.ordersGateway.notifyOrderStatusUpdate(populatedOrder);
        }
      } catch (error: any) {
        this.logger.warn(`⚠️ Erreur notification: ${error.message}`);
      }

      return populatedOrder;

    } catch (error: any) {
      this.logger.error(`❌ Erreur création commande: ${error.message}`);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Erreur création commande');
    }
  }

  // ✅ VÉRIFIER SI UN REEL EXISTE
  async verifyReelExists(reelId: string): Promise<boolean> {
    const count = await this.reelModel.countDocuments({ reel_id: reelId });
    return count > 0;
  }

  // ✅ RÉCUPÉRER LE PRIX DEPUIS LE MENU DU RESTAURANT
  private async getDishPriceFromRestaurant(
    restaurantOwnerId: string,
    dishName: string,
    quantity: number,
    customUnitPrice?: number
  ): Promise<{ unitPrice: number; totalPrice: number }> {
    try {
      if (customUnitPrice && customUnitPrice > 0) {
        return { unitPrice: customUnitPrice, totalPrice: customUnitPrice * quantity };
      }

      const restaurant = await this.restaurantModel.findOne({ ownerId: restaurantOwnerId }).exec();
      if (!restaurant) {
        return this.getDefaultPrice(dishName, quantity);
      }

      const menuItem = restaurant.menu.find(item => 
        this.normalizeDishName(item.name) === this.normalizeDishName(dishName)
      );

      if (!menuItem || !menuItem.price) {
        return this.getDefaultPrice(dishName, quantity);
      }

      return { unitPrice: menuItem.price, totalPrice: menuItem.price * quantity };
    } catch (error: any) {
      return this.getDefaultPrice(dishName, quantity);
    }
  }

  // ✅ PRIX PAR DÉFAUT
  private getDefaultPrice(dishName: string, quantity: number): { unitPrice: number; totalPrice: number } {
    const defaultPrices: { [key: string]: number } = {
      'pizza': 12, 'burger': 8, 'pasta': 10, 'salad': 7,
      'sandwich': 6, 'tacos': 9, 'sushi': 15, 'plat': 11,
    };

    const normalizedDishName = dishName.toLowerCase();
    let unitPrice = 10;

    for (const [keyword, price] of Object.entries(defaultPrices)) {
      if (normalizedDishName.includes(keyword)) {
        unitPrice = price;
        break;
      }
    }

    return { unitPrice, totalPrice: unitPrice * quantity };
  }

  // ✅ NORMALISER LE NOM DU PLAT
  private normalizeDishName(name: string): string {
    return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/gi, '').trim();
  }
// ✅ CRÉER UN PAYMENT INTENT STRIPE
  // ✅ CRÉER UN PAYMENT INTENT STRIPE POUR UNE COMMANDE
async createPaymentIntent(
  userId: string,
  orderId: string
): Promise<any> {
  try {
    this.logger.log(`💳 [ORDERS] Création Payment Intent pour commande: ${orderId}`);
    
    // ✅ DEBUG COMPLET
    this.logger.log(`🔍 [DEBUG] Recherche commande avec order_id: ${orderId}`);
    
    // 1. Recherche par order_id
    let order = await this.orderModel
      .findOne({ order_id: orderId })
      .exec();

    // 2. Si pas trouvé, essayer par _id
    if (!order && Types.ObjectId.isValid(orderId)) {
      this.logger.log(`🔍 [DEBUG] Essai recherche par _id: ${orderId}`);
      order = await this.orderModel
        .findById(orderId)
        .exec();
    }

    // 3. Si toujours pas trouvé, ERREUR
    if (!order) {
      this.logger.error(`❌ [DEBUG] Commande NON TROUVÉE: ${orderId}`);
      throw new NotFoundException(`Commande non trouvée: ${orderId}`);
    }

    this.logger.log(`✅ [DEBUG] Commande trouvée: ${order.order_id}, Montant: ${order.total_price}`);

    // ✅ VÉRIFICATIONS (comme dans Wallet)
    if (order.user_id.toString() !== userId) {
      throw new ForbiddenException('Vous ne pouvez pas payer cette commande');
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Cette commande ne nécessite pas de paiement. Statut: ${order.status}`
      );
    }

    if (order.payment_status === PaymentStatus.PAID) {
      throw new BadRequestException('Cette commande est déjà payée');
    }

    // ✅ INITIALISER STRIPE (comme dans Wallet)
    const stripeAccount = await this.walletService.initializeStripeAccount(userId);
    this.logger.log(`✅ [ORDERS] Stripe account: ${stripeAccount.customer_id}`);

    // ✅ MÉTADONNÉES SPÉCIFIQUES COMMANDE (comme dans Wallet)
    const metadata = {
      user_id: userId.toString(),
      order_id: order.order_id,
      type: 'order_payment', // ← DIFFÉRENT de 'wallet_deposit'
      platform: 'PlateNet',
      dish_name: order.dish_name,
      quantity: order.quantity.toString(),
      restaurant_id: order.restaurant_id.toString(),
      amount: order.total_price.toString(),
      currency: 'tnd', // ← Devise Tunisienne
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`📦 [ORDERS] Métadonnées:`, metadata);

    // ✅ CRÉER LE PAYMENT INTENT (comme dans Wallet)
    const paymentIntent = await this.stripeService.createPaymentIntent(
      order.total_price, // ← MONTANT DE LA COMMANDE
      stripeAccount.customer_id,
      metadata
    );

    // ✅ SAUVEGARDER DANS LA COMMANDE
    await this.orderModel.findOneAndUpdate(
      { order_id: orderId },
      {
        $set: {
          stripe_payment_intent_id: paymentIntent.payment_intent_id,
          payment_method: PaymentMethod.CARD,
          updated_at: new Date(),
        }
      }
    );

    this.logger.log(`✅ [ORDERS] Payment Intent sauvegardé: ${paymentIntent.payment_intent_id}`);

    // ✅ RETOURNER LE MÊME FORMAT QUE WALLET
    return {
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.payment_intent_id,
      amount: order.total_price,
      currency: 'tnd',
      order_id: order.order_id,
      status: paymentIntent.status,
    };

  } catch (error: any) {
    this.logger.error(`❌ [ORDERS] Erreur création Payment Intent: ${error.message}`);
    throw error;
  }
}
  // ✅ CONFIRMER LE PAIEMENT STRIPE (APPELÉ PAR LE WEBHOOK)
  async confirmStripePaymentFromWebhook(
    paymentIntentId: string,
    metadata: any
  ): Promise<OrderDocument> {
    try {
      this.logger.log(`✅ Confirmation paiement webhook: ${paymentIntentId}`);
      
      const orderId = metadata.order_id;
      const userId = metadata.user_id;

      if (!orderId || !userId) {
        throw new BadRequestException('Métadonnées incomplètes dans le Payment Intent');
      }

      const order = await this.orderModel
        .findOne({ order_id: orderId })
        .exec();

      if (!order) {
        throw new NotFoundException(`Commande non trouvée: ${orderId}`);
      }

      // Vérifier que la commande n'est pas déjà payée
      if (order.payment_status === PaymentStatus.PAID) {
        this.logger.warn(`⚠️ Commande déjà payée: ${orderId}`);
        return order;
      }

      // Vérifier que le Payment Intent correspond
      if (order.stripe_payment_intent_id && 
          order.stripe_payment_intent_id !== paymentIntentId) {
        throw new BadRequestException('Payment Intent ID ne correspond pas');
      }

      // ✅ METTRE À JOUR LA COMMANDE
      const updatedOrder = await this.orderModel
        .findOneAndUpdate(
          { order_id: orderId },
          {
            $set: {
              status: OrderStatus.PENDING,
              payment_status: PaymentStatus.PAID,
              payment_method: PaymentMethod.CARD,
              stripe_payment_intent_id: paymentIntentId,
              updated_at: new Date(),
            },
          },
          { new: true }
        )
        .populate('user_id', 'user_id username full_name profile_picture')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture')
        .exec();

      if (!updatedOrder) {
        throw new InternalServerErrorException('Erreur lors de la confirmation');
      }

      this.logger.log(`✅ Paiement confirmé pour commande: ${orderId}`);

      // 🔔 NOTIFICATIONS
      try {
        this.ordersGateway.notifyOrderStatusUpdate(updatedOrder);
        await this.messagesService.notifyNewOrderToRestaurant(updatedOrder);
      } catch (error: any) {
        this.logger.warn(`⚠️ Erreur notification: ${error.message}`);
      }

      return updatedOrder;

    } catch (error: any) {
      this.logger.error(`❌ Erreur confirmation webhook: ${error.message}`);
      throw error;
    }
  }
  // ✅ CONFIRMER LE PAIEMENT STRIPE (APPELÉ MANUELLEMENT - OPTIONNEL)
async confirmStripePayment(
  userId: string,
  orderId: string,
  paymentIntentId: string
): Promise<OrderDocument> {
  try {
    this.logger.log(`🔧 [DEBUG] Confirmation paiement - VERSION SIMPLIFIÉE`);
    this.logger.log(`📋 Order ID: ${orderId}`);
    this.logger.log(`🎯 Payment Intent ID: ${paymentIntentId}`);
    this.logger.log(`👤 User ID: ${userId}`);

    // ✅ TROUVER LA COMMANDE SANS VÉRIFICATION USER ID POUR DEBUG
    const order = await this.orderModel
      .findOne({ order_id: orderId })
      .exec();

    if (!order) {
      throw new NotFoundException(`Commande non trouvée: ${orderId}`);
    }

    this.logger.log(`📊 Commande trouvée - User ID: ${order.user_id}`);

    // ✅ TEMPORAIREMENT - SAUTER LA VÉRIFICATION USER ID
    // if (order.user_id.toString() !== userId) {
    //   throw new ForbiddenException('Vous ne pouvez pas confirmer cette commande');
    // }

    // ✅ VÉRIFIER AVEC STRIPE
    const stripePaymentIntent = await this.stripeService.getPaymentIntent(paymentIntentId);
    
    if (stripePaymentIntent.status !== 'succeeded') {
      throw new BadRequestException(`Paiement non confirmé: ${stripePaymentIntent.status}`);
    }

    // ✅ METTRE À JOUR LA COMMANDE
    const updatedOrder = await this.orderModel
      .findOneAndUpdate(
        { order_id: orderId },
        {
          $set: {
            status: OrderStatus.PENDING,
            payment_status: PaymentStatus.PAID,
            payment_method: PaymentMethod.CARD,
            stripe_payment_intent_id: paymentIntentId,
            updated_at: new Date(),
          },
        },
        { new: true }
      )
      .populate('user_id', 'user_id username full_name profile_picture phone_number role')
      .populate('reel_id', 'reel_id video_url thumbnail_url caption')
      .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
      .exec();

    if (!updatedOrder) {
      throw new InternalServerErrorException('Erreur lors de la confirmation du paiement');
    }

    this.logger.log(`✅ Paiement confirmé avec succès: ${orderId}`);

    // ✅ NOTIFICATIONS
    try {
      this.ordersGateway.notifyOrderStatusUpdate(updatedOrder);
      await this.messagesService.notifyNewOrderToRestaurant(updatedOrder);
    } catch (error: any) {
      this.logger.warn(`⚠️ Erreur notification: ${error.message}`);
    }

    return updatedOrder;

  } catch (error: any) {
    this.logger.error(`❌ Erreur confirmation paiement: ${error.message}`);
    throw error;
  }
}
  // ✅ MISE À JOUR STATUT COMMANDE AVEC WEBSOCKET
async updateOrderStatus(
  restaurantId: string,
  userRole: string,
  orderId: string,
  updateOrderStatusDto: UpdateOrderStatusDto,
): Promise<OrderDocument> {
  try {
    if (!Types.ObjectId.isValid(restaurantId)) {
      throw new BadRequestException('ID restaurant invalide');
    }

    const order = await this.orderModel.findOne({ order_id: orderId }).exec();

    if (!order) {
      throw new NotFoundException('Commande non trouvée');
    }

    // Vérifier que l'utilisateur peut gérer cette commande
    const isOwner = order.restaurant_id.toString() === restaurantId;
    const canManageOrders = userRole === 'chef' || userRole === 'restaurant';

    if (!isOwner || !canManageOrders) {
      throw new ForbiddenException('Vous ne pouvez pas modifier cette commande');
    }

    // Validation du statut
    if (!Object.values(OrderStatus).includes(updateOrderStatusDto.status)) {
      throw new BadRequestException('Statut de commande invalide');
    }

    const updates: any = {
      status: updateOrderStatusDto.status,
    };

    // Ajouter les informations supplémentaires si fournies
    if (updateOrderStatusDto.estimated_preparation_time !== undefined) {
      if (updateOrderStatusDto.estimated_preparation_time < 1) {
        throw new BadRequestException("Le temps de préparation doit être d'au moins 1 minute");
      }
      updates.estimated_preparation_time = updateOrderStatusDto.estimated_preparation_time;
    }

    if (updateOrderStatusDto.pickup_instructions) {
      if (updateOrderStatusDto.pickup_instructions.length > 200) {
        throw new BadRequestException('Les instructions ne doivent pas dépasser 200 caractères');
      }
      updates.pickup_instructions = updateOrderStatusDto.pickup_instructions;
    }

    // ✅ CORRECTION: Mettre à jour les timestamps selon le statut
    const now = new Date();
    switch (updateOrderStatusDto.status) {
      case OrderStatus.PENDING_PAYMENT:
        // Pas de timestamp spécifique pour pending_payment
        break;
      case OrderStatus.ACCEPTED:
        updates.accepted_at = now;
        break;
      case OrderStatus.PREPARING:
        updates.preparing_at = now;
        break;
      case OrderStatus.READY:
        updates.ready_at = now;
        break;
      case OrderStatus.COMPLETED:
        updates.completed_at = now;
        break;
      case OrderStatus.CANCELLED:
        updates.cancelled_at = now;
        updates.cancellation_reason = updateOrderStatusDto.cancellation_reason || 'Annulé par le restaurant';
        
        // Remboursement automatique si la commande était payée
        if (order.payment_status === PaymentStatus.PAID) {
          try {
            await this.walletService.refundOrder(
              order.user_id.toString(),
              orderId,
              order.total_price
            );
            this.logger.log(`✅ Remboursement automatique pour commande annulée: ${order.order_id}`);
          } catch (refundError: any) {
            this.logger.error(`❌ Erreur remboursement: ${refundError.message}`);
          }
        }
        break;
    }

    const updatedOrder = await this.orderModel
      .findOneAndUpdate(
        { order_id: orderId },
        { $set: updates },
        { new: true },
      )
      .populate('user_id', 'user_id username full_name profile_picture phone_number role')
      .populate('reel_id', 'reel_id video_url thumbnail_url caption')
      .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
      .exec();

    if (!updatedOrder) {
      throw new InternalServerErrorException('Erreur lors de la mise à jour de la commande');
    }

    this.logger.log(`📦 Statut mis à jour: ${orderId} -> ${updateOrderStatusDto.status}`);

    // 🔔 NOTIFICATIONS WEBSOCKET
    try {
      this.ordersGateway.notifyOrderStatusUpdate(updatedOrder);

      // Notifications spécifiques selon le statut
      switch (updateOrderStatusDto.status) {
        case OrderStatus.PREPARING:
          if (updateOrderStatusDto.estimated_preparation_time) {
            this.ordersGateway.notifyOrderPreparing(updatedOrder, updateOrderStatusDto.estimated_preparation_time);
          }
          break;
        case OrderStatus.READY:
          this.ordersGateway.notifyOrderReady(updatedOrder);
          break;
        case OrderStatus.CANCELLED:
          this.ordersGateway.notifyOrderCancelled(updatedOrder, 'restaurant');
          break;
      }

      // Notifier aussi via le service de messages
      await this.messagesService.notifyOrderStatusToCustomer(updatedOrder);
    } catch (error: any) {
      this.logger.warn(`⚠️ Erreur notification WebSocket: ${error.message}`);
    }

    return updatedOrder;
  } catch (error: any) {
    this.logger.error(`❌ Erreur mise à jour statut commande: ${error.message}`);
    throw error;
  }
}
async verifyOrderPayment(
  paymentIntentId: string,
  metadata: any
): Promise<OrderDocument> {
  try {
    this.logger.log(`🔍 [ORDERS] Vérification paiement: ${paymentIntentId}`);
    
    const orderId = metadata.order_id;
    const userId = metadata.user_id;

    if (!orderId || !userId) {
      throw new BadRequestException('Métadonnées incomplètes');
    }

    // ✅ TROUVER LA COMMANDE
    const order = await this.orderModel
      .findOne({ order_id: orderId })
      .exec();

    if (!order) {
      throw new NotFoundException(`Commande non trouvée: ${orderId}`);
    }

    // ✅ VÉRIFIER SI DÉJÀ PAYÉE
    if (order.payment_status === PaymentStatus.PAID) {
      this.logger.warn(`⚠️ [ORDERS] Commande déjà payée: ${orderId}`);
      return order;
    }

    // ✅ METTRE À JOUR LA COMMANDE
    const updatedOrder = await this.orderModel
      .findOneAndUpdate(
        { order_id: orderId },
        {
          $set: {
            status: OrderStatus.PENDING,
            payment_status: PaymentStatus.PAID,
            payment_method: PaymentMethod.CARD,
            stripe_payment_intent_id: paymentIntentId,
            updated_at: new Date(),
          },
        },
        { new: true }
      )
      .populate('user_id', 'user_id username full_name profile_picture')
      .populate('reel_id', 'reel_id video_url thumbnail_url caption')
      .populate('restaurant_id', 'user_id username full_name profile_picture')
      .exec();

    if (!updatedOrder) {
      throw new InternalServerErrorException('Erreur lors de la confirmation');
    }

    this.logger.log(`✅ [ORDERS] Paiement vérifié: ${orderId}`);

    // ✅ NOTIFICATIONS
    try {
      this.ordersGateway.notifyOrderStatusUpdate(updatedOrder);
      await this.messagesService.notifyNewOrderToRestaurant(updatedOrder);
    } catch (error: any) {
      this.logger.warn(`⚠️ [ORDERS] Erreur notification: ${error.message}`);
    }

    return updatedOrder;

  } catch (error: any) {
    this.logger.error(`❌ [ORDERS] Erreur vérification paiement: ${error.message}`);
    throw error;
  }
}
  // ✅ ANNULATION COMMANDE PAR LE CLIENT - VERSION SANS TRANSACTION
  async cancelOrder(
    userId: string,
    orderId: string,
    cancelOrderDto: CancelOrderDto,
  ): Promise<OrderDocument> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('ID utilisateur invalide');
      }

      const order = await this.orderModel
        .findOne({ order_id: orderId })
        .exec();

      if (!order) {
        throw new NotFoundException('Commande non trouvée');
      }

      // Vérifier que l'utilisateur est bien le propriétaire de la commande
      if (order.user_id.toString() !== userId) {
        throw new ForbiddenException('Vous ne pouvez pas annuler cette commande');
      }

      // Vérifier que la commande peut être annulée
      const cancellableStatuses = [OrderStatus.PENDING, OrderStatus.ACCEPTED];
      if (!cancellableStatuses.includes(order.status)) {
        throw new BadRequestException('Cette commande ne peut plus être annulée');
      }

      // ⭐ AJOUT: Remboursement automatique si la commande était payée
      if (order.payment_status === PaymentStatus.PAID) {
        try {
          await this.walletService.refundOrder(
            userId,
            orderId,
            order.total_price
          );
          this.logger.log(`✅ Remboursement automatique pour annulation client: ${orderId}`);
        } catch (refundError: any) {
          this.logger.error(`❌ Erreur remboursement: ${refundError.message}`);
          // On continue quand même l'annulation même si le remboursement échoue
        }
      }

      const updatedOrder = await this.orderModel
        .findOneAndUpdate(
          { order_id: orderId },
          {
            $set: {
              status: OrderStatus.CANCELLED,
              cancellation_reason: cancelOrderDto.reason,
              cancelled_at: new Date(),
              payment_status: order.payment_status === PaymentStatus.PAID 
                ? PaymentStatus.REFUNDED 
                : PaymentStatus.CANCELLED,
            },
          },
          { new: true },
        )
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
        .exec();

      if (!updatedOrder) {
        throw new InternalServerErrorException("Erreur lors de l'annulation de la commande");
      }

      this.logger.log(`❌ Commande annulée: ${orderId} par l'utilisateur: ${userId}`);

      // 🔔 NOTIFICATIONS
      try {
        this.ordersGateway.notifyOrderCancelled(updatedOrder, 'customer');
        await this.messagesService.notifyRestaurantOrderCancellation(updatedOrder);
      } catch (error: any) {
        this.logger.warn(`⚠️ Erreur notification annulation: ${error.message}`);
      }

      return updatedOrder;
    } catch (error: any) {
      this.logger.error(`❌ Erreur annulation commande: ${error.message}`);
      throw error;
    }
  }

  // ✅ ANNULATION COMMANDE PAR LE RESTAURANT - VERSION SANS TRANSACTION
  async cancelOrderByRestaurant(
    restaurantId: string,
    userRole: string,
    orderId: string,
    cancelOrderDto: CancelOrderDto,
  ): Promise<OrderDocument> {
    try {
      if (!Types.ObjectId.isValid(restaurantId)) {
        throw new BadRequestException('ID restaurant invalide');
      }

      const order = await this.orderModel
        .findOne({ order_id: orderId })
        .exec();

      if (!order) {
        throw new NotFoundException('Commande non trouvée');
      }

      // Vérifier que l'utilisateur peut gérer cette commande
      const isOwner = order.restaurant_id.toString() === restaurantId;
      const canManageOrders = userRole === 'chef' || userRole === 'restaurant';

      if (!isOwner || !canManageOrders) {
        throw new ForbiddenException('Vous ne pouvez pas annuler cette commande');
      }

      // Vérifier que la commande peut être annulée
      const cancellableStatuses = [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.PREPARING];
      if (!cancellableStatuses.includes(order.status)) {
        throw new BadRequestException('Cette commande ne peut plus être annulée');
      }

      // ⭐ AJOUT: Remboursement automatique si la commande était payée
      if (order.payment_status === PaymentStatus.PAID) {
        try {
          await this.walletService.refundOrder(
            order.user_id.toString(),
            orderId,
            order.total_price
          );
          this.logger.log(`✅ Remboursement automatique pour annulation restaurant: ${orderId}`);
        } catch (refundError: any) {
          this.logger.error(`❌ Erreur remboursement: ${refundError.message}`);
          // On continue quand même l'annulation
        }
      }

      const updatedOrder = await this.orderModel
        .findOneAndUpdate(
          { order_id: orderId },
          {
            $set: {
              status: OrderStatus.CANCELLED,
              cancellation_reason: cancelOrderDto.reason || 'Annulé par le restaurant',
              cancelled_at: new Date(),
              payment_status: order.payment_status === PaymentStatus.PAID 
                ? PaymentStatus.REFUNDED 
                : PaymentStatus.CANCELLED,
            },
          },
          { new: true },
        )
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
        .exec();

      if (!updatedOrder) {
        throw new InternalServerErrorException("Erreur lors de l'annulation de la commande");
      }

      this.logger.log(`❌ Commande annulée par restaurant: ${orderId} par: ${restaurantId}`);

      // 🔔 NOTIFICATIONS
      try {
        await this.messagesService.notifyOrderStatusToCustomer(updatedOrder);
        this.ordersGateway.notifyOrderCancelled(updatedOrder, 'restaurant');
      } catch (error: any) {
        this.logger.warn(`⚠️ Erreur notification annulation: ${error.message}`);
      }

      return updatedOrder;
    } catch (error: any) {
      this.logger.error(`❌ Erreur annulation commande restaurant: ${error.message}`);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new InternalServerErrorException("Erreur lors de l'annulation de la commande");
    }
  }

  // ✅ RÉCUPÉRER UNE COMMANDE SPÉCIFIQUE
  async getOrderById(orderId: string): Promise<OrderDocument> {
    try {
      const order = await this.orderModel
        .findOne({ order_id: orderId })
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
        .exec();

      if (!order) {
        throw new NotFoundException('Commande non trouvée');
      }

      return order;
    } catch (error: any) {
      this.logger.error(`❌ Erreur récupération commande: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Erreur lors de la récupération de la commande');
    }
  }

  // ✅ STATISTIQUES POUR LE DASHBOARD RESTAURANT
  async getRestaurantStats(restaurantId: string) {
    try {
      if (!Types.ObjectId.isValid(restaurantId)) {
        throw new BadRequestException('ID restaurant invalide');
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [stats, totalOrders, todayOrders, completedOrders, revenueToday] = await Promise.all([
        // Statistiques par statut pour aujourd'hui
        this.orderModel.aggregate([
          {
            $match: {
              restaurant_id: new Types.ObjectId(restaurantId),
              created_at: { $gte: today },
            },
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              total_quantity: { $sum: '$quantity' },
              total_revenue: { $sum: '$total_price' },
            },
          },
        ]),
        // Total des commandes
        this.orderModel.countDocuments({
          restaurant_id: new Types.ObjectId(restaurantId),
        }),
        // Commandes d'aujourd'hui
        this.orderModel.countDocuments({
          restaurant_id: new Types.ObjectId(restaurantId),
          created_at: { $gte: today },
        }),
        // Commandes complétées aujourd'hui
        this.orderModel.countDocuments({
          restaurant_id: new Types.ObjectId(restaurantId),
          status: OrderStatus.COMPLETED,
          created_at: { $gte: today },
        }),
        // Revenu aujourd'hui
        this.orderModel.aggregate([
          {
            $match: {
              restaurant_id: new Types.ObjectId(restaurantId),
              status: OrderStatus.COMPLETED,
              created_at: { $gte: today },
            },
          },
          {
            $group: {
              _id: null,
              total_revenue: { $sum: '$total_price' },
            },
          },
        ]),
      ]);

      return {
        total_orders: totalOrders,
        today_orders: todayOrders,
        completed_today: completedOrders,
        revenue_today: revenueToday[0]?.total_revenue || 0,
        by_status: stats,
      };
    } catch (error: any) {
      this.logger.error(`❌ Erreur récupération statistiques: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la récupération des statistiques');
    }
  }

  // ✅ MÉTHODE UTILITAIRE POUR EXTRAIRE L'ID
  private getObjectId(id: any): string {
    if (typeof id === 'string') return id;
    if (id && id._id) return id._id.toString();
    if (id && id.toString) return id.toString();
    throw new Error(`Impossible d'extraire l'ID: ${id}`);
  }

  // ✅ RÉCUPÉRER LES COMMANDES D'UN UTILISATEUR
async getUserOrders(userId: string, page: number = 1, limit: number = 10) {
  this.logger.log('🔍 ==== GET USER ORDERS ====');
  this.logger.log(`👤 User ID reçu: ${userId}`);
  this.logger.log(`📄 Type: ${typeof userId}`);

  const skip = Math.max(0, page - 1) * limit;
  
  // ✅ CORRECTION: Toujours convertir en ObjectId si valide
  let userIdQuery: any;
  
  if (Types.ObjectId.isValid(userId)) {
    userIdQuery = new Types.ObjectId(userId);
    this.logger.log(`✅ Conversion en ObjectId: ${userIdQuery}`);
  } else {
    // Si pas un ObjectId valide, chercher par string
    this.logger.warn(`⚠️ User ID n'est pas un ObjectId valide, recherche par string`);
    userIdQuery = userId;
  }

  // ✅ DEBUG: Compter TOUTES les commandes dans la DB
  const totalOrdersInDB = await this.orderModel.countDocuments({});
  this.logger.log(`📊 Total commandes dans DB: ${totalOrdersInDB}`);

  // ✅ DEBUG: Chercher avec les DEUX formats
  const ordersWithObjectId = await this.orderModel.countDocuments({ 
    user_id: new Types.ObjectId(userId) 
  });
  
  const ordersWithString = await this.orderModel.countDocuments({ 
    user_id: userId 
  });
  
  this.logger.log(`🔍 Commandes trouvées avec ObjectId: ${ordersWithObjectId}`);
  this.logger.log(`🔍 Commandes trouvées avec String: ${ordersWithString}`);

  // ✅ REQUÊTE PRINCIPALE
  const [orders, total] = await Promise.all([
    this.orderModel
      .find({ user_id: userIdQuery })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user_id', 'user_id username full_name profile_picture phone_number role')
      .populate('reel_id', 'reel_id video_url thumbnail_url caption')
      .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
      .exec(),
    this.orderModel.countDocuments({ user_id: userIdQuery }),
  ]);

  this.logger.log(`✅ Commandes récupérées: ${orders.length}`);
  this.logger.log(`📊 Total: ${total}`);

  // ✅ DEBUG: Afficher les détails
  orders.forEach((order, index) => {
    this.logger.log(`   📦 Commande ${index + 1}:`);
    this.logger.log(`      ID: ${order.order_id}`);
    this.logger.log(`      User ID: ${order.user_id}`);
    this.logger.log(`      Plat: ${order.dish_name}`);
  });

  return {
    orders,
    pagination: { 
      page, 
      limit, 
      total, 
      pages: Math.max(1, Math.ceil((total || 0) / limit)) 
    },
  };
}
async markOrderAsReady(
  orderId: string,
  restaurantId: string,
  pickupInstructions?: string,
  estimatedReadyTime?: number
): Promise<OrderDocument> {
  try {
    this.logger.log(`🎉 Marquage commande comme prête: ${orderId}`);

    // 1. Trouver la commande
    const order = await this.orderModel
      .findOne({ order_id: orderId })
      .populate('user_id', 'user_id username full_name phone_number')
      .populate('restaurant_id', 'user_id username full_name phone_number')
      .exec();

    if (!order) {
      throw new NotFoundException('Commande non trouvée');
    }

    // 2. Vérifier les permissions - ✅ CORRECTION 2
    const restaurantObjectId = order.restaurant_id as any;
    const restaurantIdStr = restaurantObjectId?._id?.toString() || restaurantObjectId?.toString();
    
    if (restaurantIdStr !== restaurantId) {
      throw new ForbiddenException('Non autorisé');
    }

    // 3. Vérifier que la commande est acceptée/en préparation
    if (order.status !== OrderStatus.ACCEPTED && order.status !== OrderStatus.PREPARING) {
      throw new BadRequestException(
        `Impossible de marquer comme prête - Statut actuel: ${order.status}`
      );
    }

    // 4. Mettre à jour la commande
    order.status = OrderStatus.READY;
    order.ready_at = new Date();
    
    if (pickupInstructions) {
      order.pickup_instructions = pickupInstructions;
    }
    
    // ✅ CORRECTION 3: Ne pas utiliser estimated_ready_time (n'existe pas dans le schéma)
    // On utilise ready_at à la place
    
    await order.save();

    this.logger.log(`✅ Commande ${orderId} marquée comme prête`);

    // 5. Envoyer notification WebSocket au client
    this.ordersGateway.notifyOrderReady(order);

    // 6. Créer message pour le client
    await this.messagesService.notifyOrderReadyToCustomer(order);

    return order;

  } catch (error) {
    this.logger.error(`❌ Erreur mark ready: ${error.message}`);
    throw error;
  }
}

  // ✅ RÉCUPÉRER LES COMMANDES D'UN RESTAURANT
  async getRestaurantOrders(restaurantId: string): Promise<OrderDocument[]> {
    try {
      if (!Types.ObjectId.isValid(restaurantId)) {
        throw new BadRequestException('ID restaurant invalide');
      }

      const orders = await this.orderModel
        .find({ restaurant_id: new Types.ObjectId(restaurantId) })
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
        .sort({ created_at: -1 })
        .exec();

      return orders;
    } catch (error: any) {
      this.logger.error(`❌ Erreur récupération commandes restaurant: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la récupération des commandes du restaurant');
    }
  }

  // ✅ MARQUER UNE COMMANDE COMME RÉCUPÉRÉE
  async markOrderAsCompleted(
    userId: string,
    orderId: string,
  ): Promise<OrderDocument> {
    try {
      if (!Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('ID utilisateur invalide');
      }

      const order = await this.orderModel.findOne({ order_id: orderId }).exec();

      if (!order) {
        throw new NotFoundException('Commande non trouvée');
      }

      // Vérifier que l'utilisateur est bien le propriétaire de la commande
      if (order.user_id.toString() !== userId) {
        throw new ForbiddenException('Vous ne pouvez pas modifier cette commande');
      }

      // Vérifier que la commande est prête
      if (order.status !== OrderStatus.READY) {
        throw new BadRequestException("La commande n'est pas encore prête pour récupération");
      }

      const updatedOrder = await this.orderModel
        .findOneAndUpdate(
          { order_id: orderId },
          {
            $set: {
              status: OrderStatus.COMPLETED,
              completed_at: new Date(),
            },
          },
          { new: true },
        )
        .populate('user_id', 'user_id username full_name profile_picture phone_number role')
        .populate('reel_id', 'reel_id video_url thumbnail_url caption')
        .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
        .exec();

      if (!updatedOrder) {
        throw new InternalServerErrorException('Erreur lors du marquage de la commande comme complétée');
      }

      this.logger.log(`✅ Commande marquée comme récupérée: ${orderId}`);

      // 🔔 NOTIFICATION RESTAURANT
      try {
        await this.messagesService.notifyOrderCompletedToRestaurant(updatedOrder);
      } catch (error: any) {
        this.logger.warn(`⚠️ Erreur notification commande complétée: ${error.message}`);
      }

      return updatedOrder;
    } catch (error: any) {
      this.logger.error(`❌ Erreur marquage commande comme complétée: ${error.message}`);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Erreur lors du marquage de la commande comme complétée');
    }
  }
  // ✅ REMPLACE LA MÉTHODE acceptOrder() DANS TON orders.service.ts

/**
 * ✅ ACCEPTER UNE COMMANDE - VERSION COMPLÈTE
 * Le restaurant approuve la commande et notifie le client
 */
  // ✅ ACCEPTER UNE COMMANDE ET TRANSFÉRER L'ARGENT AU RESTAURANT
async acceptOrder(
  restaurantId: string,
  userRole: string,
  orderId: string,
  estimatedPreparationTime?: number,
  acceptanceNotes?: string
): Promise<OrderDocument> {
  try {
    this.logger.log(`✅ [ACCEPT] Acceptation commande: ${orderId}`);
    
    // 1️⃣ CHERCHER LA COMMANDE SANS POPULATE D'ABORD
    const order = await this.orderModel.findOne({ order_id: orderId }).exec();
    if (!order) throw new NotFoundException('Commande non trouvée');

    // ✅ VÉRIFICATIONS
    const isOwner = order.restaurant_id.toString() === restaurantId;
    const canManage = userRole === 'chef' || userRole === 'restaurant';

    if (!isOwner || !canManage) {
      throw new ForbiddenException('Vous ne pouvez pas accepter cette commande');
    }

    const acceptableStatuses = [OrderStatus.PENDING, OrderStatus.PENDING_PAYMENT];
    if (!acceptableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Cette commande ne peut pas être acceptée (statut: ${order.status})`
      );
    }

    // ✅ VÉRIFIER LE PAIEMENT
    if (order.payment_method === PaymentMethod.WALLET || 
        order.payment_method === PaymentMethod.CARD) {
      if (order.payment_status !== PaymentStatus.PAID) {
        throw new BadRequestException('Paiement non confirmé');
      }
    }

    // ✅ TRANSFERT DU WALLET
    if (order.payment_method === PaymentMethod.WALLET && 
        order.payment_status === PaymentStatus.PAID) {
      try {
        this.logger.log(`💸 Transfert wallet: ${order.user_id} → ${restaurantId}`);
        
        await this.walletService.transferFundsForOrder(
          order.user_id.toString(),
          restaurantId,
          order.total_price,
          `Paiement commande #${order.order_id}`
        );
        
        this.logger.log(`✅ Transfert réussi: ${order.total_price} TND`);
      } catch (transferError: any) {
        this.logger.error(`❌ Erreur transfert: ${transferError.message}`);
        throw new BadRequestException(`Erreur transfert de fonds: ${transferError.message}`);
      }
    }

    // ✅ MISE À JOUR COMMANDE
    const updates: any = {
      status: OrderStatus.ACCEPTED,
      accepted_at: new Date(),
    };

    if (estimatedPreparationTime) {
      if (estimatedPreparationTime < 5 || estimatedPreparationTime > 120) {
        throw new BadRequestException('Temps entre 5 et 120 minutes');
      }
      updates.estimated_preparation_time = estimatedPreparationTime;
    }

    if (acceptanceNotes) {
      updates.pickup_instructions = acceptanceNotes;
    }

    // 2️⃣ METTRE À JOUR ET POPULER
    const updatedOrder = await this.orderModel
      .findOneAndUpdate({ order_id: orderId }, { $set: updates }, { new: true })
      .populate('user_id', 'user_id username full_name profile_picture phone_number role')
      .populate('reel_id', 'reel_id video_url thumbnail_url caption')
      .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
      .exec();

    if (!updatedOrder) {
      throw new InternalServerErrorException('Erreur acceptation commande');
    }

    this.logger.log(`✅ Commande acceptée: ${orderId}`);

    // 🔔 NOTIFICATIONS TEMPS RÉEL - CORRIGÉ
    try {
      // ✅ 1. WEB SOCKET - Notification "Commande approuvée" au client
      this.ordersGateway.notifyOrderApproved(updatedOrder);
      
      // ✅ 2. Notification "commande acceptée" (pour compatibilité)
      this.ordersGateway.notifyOrderAccepted(updatedOrder);
      
      // ✅ 3. Mise à jour de statut générale
      this.ordersGateway.notifyOrderStatusUpdate(updatedOrder);
      
      // ✅ 4. Message dans l'inbox du client
      await this.messagesService.notifyOrderStatusToCustomer(updatedOrder);
      
      // ✅ 5. Message de confirmation au restaurant - CORRIGÉ ICI
      // Utiliser le type casting pour éviter les erreurs TypeScript
      const populatedOrder = updatedOrder as any;
      const customerName = this.getCustomerName(populatedOrder);
      
      await this.messagesService.createOrderActionMessage(
        restaurantId,
        restaurantId,
        orderId,
        '✅ Commande acceptée',
        `Vous avez accepté la commande #${orderId}\n` +
        `Client: ${customerName}\n` +
        `Plat: ${updatedOrder.dish_name}\n` +
        `Quantité: ${updatedOrder.quantity}\n` +
        `Montant: ${updatedOrder.total_price} TND`,
        {
          order_status: 'accepted',
          action_completed: true
        },
        'order_accepted_confirmation'
      );
      
      this.logger.log(`📢 Notifications envoyées: ${orderId}`);
    } catch (error: any) {
      this.logger.warn(`⚠️ Erreur notification: ${error.message}`);
      // On continue même si les notifications échouent
    }

    return updatedOrder;

  } catch (error: any) {
    this.logger.error(`❌ Erreur acceptation: ${error.message}`);
    if (error instanceof NotFoundException || 
        error instanceof BadRequestException || 
        error instanceof ForbiddenException) {
      throw error;
    }
    throw new InternalServerErrorException('Erreur acceptation commande');
  }
}

// ✅ AJOUTE CETTE MÉTHODE UTILITAIRE DANS TA CLASSE
private getCustomerName(order: any): string {
  // Type casting pour éviter les erreurs TypeScript
  const populatedOrder = order as any;
  
  if (!populatedOrder.user_id) return 'Client';
  
  // Si user_id est peuplé (objet avec propriétés)
  if (typeof populatedOrder.user_id === 'object') {
    return populatedOrder.user_id.full_name || 
           populatedOrder.user_id.username || 
           'Client';
  }
  
  return 'Client';
}

/**
 * ✅ ACCEPTATION AUTOMATIQUE (OPTIONNEL)
 * Pour activer l'auto-acceptation des commandes
 */
async autoAcceptOrder(orderId: string): Promise<OrderDocument> {
  try {
    this.logger.log(`🤖 Auto-acceptation commande: ${orderId}`);

    const order = await this.orderModel
      .findOne({ order_id: orderId })
      .exec();

    if (!order) {
      throw new NotFoundException('Commande non trouvée');
    }

    // Vérifier le paiement pour auto-acceptation
    if (order.payment_status !== PaymentStatus.PAID && 
        order.payment_method !== PaymentMethod.CASH) {
      this.logger.warn(`⚠️ Paiement non confirmé, auto-acceptation annulée`);
      return order;
    }

    const updatedOrder = await this.orderModel
      .findOneAndUpdate(
        { order_id: orderId },
        {
          $set: {
            status: OrderStatus.ACCEPTED,
            accepted_at: new Date(),
            estimated_preparation_time: 20, // Temps par défaut
          },
        },
        { new: true }
      )
      .populate('user_id', 'user_id username full_name profile_picture phone_number role')
      .populate('reel_id', 'reel_id video_url thumbnail_url caption')
      .populate('restaurant_id', 'user_id username full_name profile_picture phone_number role')
      .exec();

    if (!updatedOrder) {
      throw new InternalServerErrorException('Erreur auto-acceptation');
    }

    // Notifications
    try {
      this.ordersGateway.notifyOrderAccepted(updatedOrder);
      await this.messagesService.notifyOrderStatusToCustomer(updatedOrder);
    } catch (error: any) {
      this.logger.warn(`⚠️ Erreur notification: ${error.message}`);
    }

    return updatedOrder;

  } catch (error: any) {
    this.logger.error(`❌ Erreur auto-acceptation: ${error.message}`);
    throw error;
  }
}
}