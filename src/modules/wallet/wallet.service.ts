// src/modules/wallet/wallet.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import { Transaction, TransactionDocument, TransactionType, TransactionStatus } from './transaction.schema';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
    private stripeService: StripeService,
  ) {}

  // ✅ CRÉDITER LE WALLET APRÈS UN PAIEMENT STRIPE RÉUSSI
  async creditWalletAfterPayment(
    userId: string,
    amount: number,
    stripePaymentIntentId: string,
  ) {
    const session = await this.userModel.startSession();
    session.startTransaction();

    try {
      const user = await this.userModel.findById(userId).session(session);
      if (!user) {
        throw new NotFoundException('Utilisateur non trouvé');
      }

      // Créer la transaction
      const transactions = await this.transactionModel.create([{
        user_id: new Types.ObjectId(userId),
        type: TransactionType.DEPOSIT,
        amount: amount,
        status: TransactionStatus.COMPLETED,
        balance_before: user.balance || 0,
        stripe_payment_intent_id: stripePaymentIntentId,
        description: `Recharge wallet via Stripe: ${amount} USD`,
        completed_at: new Date(),
      }], { session });

      const transaction = transactions[0];

      // Créditer le wallet
      user.balance = (user.balance || 0) + amount;
      transaction.balance_after = user.balance;
      
      await user.save({ session });
      await transaction.save({ session });

      await session.commitTransaction();

      this.logger.log(`✅ Wallet crédité: ${amount} USD pour user ${userId}`);

      return {
        transaction_id: transaction.transaction_id,
        new_balance: user.balance,
        amount: amount,
      };

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`❌ Erreur crédit wallet: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ✅ RECHARGER LE WALLET (DÉPÔT)
// ✅ CORRECTION: Retirez la confirmation backend
async depositToWallet(userId: string, amount: number, paymentMethodId: string) {
  try {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    if (amount <= 0) throw new BadRequestException('Le montant doit être positif');

    // ✅ Créer le customer Stripe si nécessaire
    let stripeCustomerId = user.stripe_customer_id;
    if (!stripeCustomerId) {
      stripeCustomerId = await this.stripeService.createCustomer({
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
      });
      user.stripe_customer_id = stripeCustomerId;
      await user.save();
    }

    // ✅ Créer la transaction PENDING
    const transaction = await this.transactionModel.create({
      user_id: new Types.ObjectId(userId),
      type: TransactionType.DEPOSIT,
      amount: amount,
      status: TransactionStatus.PENDING,
      balance_before: user.balance || 0,
      description: `Recharge wallet: ${amount} USD`,
    });

    // ✅ Créer le Payment Intent SEULEMENT
    const paymentIntent = await this.stripeService.createPaymentIntent(
      amount,
      stripeCustomerId,
      {
        user_id: user.user_id,
        transaction_id: transaction.transaction_id,
        type: 'wallet_deposit',
      }
    );

    // ✅ Mettre à jour la transaction avec l'ID Stripe
    await this.transactionModel.findByIdAndUpdate(
      transaction._id,
      {
        stripe_payment_intent_id: paymentIntent.payment_intent_id,
      }
    );

    this.logger.log(`✅ Payment Intent créé: ${paymentIntent.payment_intent_id}`);

    return {
      success: true,
      payment_intent_id: paymentIntent.payment_intent_id,
      client_secret: paymentIntent.client_secret,
      transaction_id: transaction.transaction_id,
    };

  } catch (error) {
    this.logger.error(`❌ Erreur création payment intent: ${error.message}`);
    throw error;
  }
}

  // ✅ PAYER UNE COMMANDE AVEC LE WALLET
  async payOrderWithWallet(userId: string, orderId: string, amount: number) {
    const session = await this.userModel.startSession();
    session.startTransaction();

    try {
      const user = await this.userModel.findById(userId).session(session);
      if (!user) {
        throw new NotFoundException('Utilisateur non trouvé');
      }

      // ✅ Vérifier le solde
      if ((user.balance || 0) < amount) {
        throw new BadRequestException('Solde insuffisant');
      }

      // ✅ Créer la transaction de paiement
      const transactions = await this.transactionModel.create([{
        user_id: new Types.ObjectId(userId),
        type: TransactionType.PAYMENT,
        amount: -amount, // Négatif pour le débit
        status: TransactionStatus.PENDING,
        order_id: new Types.ObjectId(orderId),
        balance_before: user.balance || 0,
        description: `Paiement commande #${orderId}`,
      }], { session });

      const transaction = transactions[0];

      // ✅ Débiter le wallet
      user.balance = (user.balance || 0) - amount;
      await user.save({ session });

      // ✅ Marquer la transaction comme complétée
      const completedTransaction = await this.transactionModel
        .findByIdAndUpdate(
          transaction._id,
          {
            status: TransactionStatus.COMPLETED,
            balance_after: user.balance,
            completed_at: new Date(),
          },
          { new: true, session }
        );

      if (!completedTransaction) {
        throw new InternalServerErrorException('Erreur lors de la mise à jour de la transaction');
      }

      await session.commitTransaction();

      this.logger.log(`✅ Paiement commande ${orderId} effectué: ${amount} USD`);

      return completedTransaction;

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`❌ Erreur paiement commande: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ✅ REMBOURSER UNE COMMANDE
  async refundOrder(userId: string, orderId: string, amount: number) {
    const session = await this.userModel.startSession();
    session.startTransaction();

    try {
      const user = await this.userModel.findById(userId).session(session);
      if (!user) {
        throw new NotFoundException('Utilisateur non trouvé');
      }

      // ✅ Créer la transaction de remboursement
      const transactions = await this.transactionModel.create([{
        user_id: new Types.ObjectId(userId),
        type: TransactionType.REFUND,
        amount: amount,
        status: TransactionStatus.PENDING,
        order_id: new Types.ObjectId(orderId),
        balance_before: user.balance || 0,
        description: `Remboursement commande #${orderId}`,
      }], { session });

      const transaction = transactions[0];

      // ✅ Créditer le wallet
      user.balance = (user.balance || 0) + amount;
      await user.save({ session });

      // ✅ Marquer la transaction comme complétée
      const completedTransaction = await this.transactionModel
        .findByIdAndUpdate(
          transaction._id,
          {
            status: TransactionStatus.COMPLETED,
            balance_after: user.balance,
            completed_at: new Date(),
          },
          { new: true, session }
        );

      if (!completedTransaction) {
        throw new InternalServerErrorException('Erreur lors de la mise à jour de la transaction');
      }

      await session.commitTransaction();

      this.logger.log(`✅ Remboursement commande ${orderId}: ${amount} USD`);

      return completedTransaction;

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`❌ Erreur remboursement: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }
async verifyPaymentIntentAndCredit(paymentIntentId: string, userId: string) {
  try {
    this.logger.log(`🔍 Vérification manuelle du Payment Intent: ${paymentIntentId}`);
    
    // 1. Vérifier le statut avec Stripe
    const paymentIntent = await this.stripeService.getPaymentIntent(paymentIntentId);
    
    if (paymentIntent.status === 'succeeded') {
      const amount = paymentIntent.amount / 100;
      this.logger.log(`✅ Paiement réussi: ${amount} USD`);
      
      // 2. Vérifier si déjà crédité
      const existingTransaction = await this.transactionModel.findOne({
        stripe_payment_intent_id: paymentIntentId,
        status: TransactionStatus.COMPLETED
      });
      
      if (existingTransaction) {
        this.logger.log(`⚠️ Transaction déjà créditée: ${existingTransaction.transaction_id}`);
        return existingTransaction;
      }
      
      // 3. Créditer le wallet
      return await this.creditWalletAfterPayment(userId, amount, paymentIntentId);
    } else {
      this.logger.warn(`⚠️ Payment Intent pas encore réussi: ${paymentIntent.status}`);
      throw new BadRequestException(`Paiement en statut: ${paymentIntent.status}`);
    }
  } catch (error) {
    this.logger.error(`❌ Erreur vérification: ${error.message}`);
    throw error;
  }
}
  // ✅ TRANSFÉRER DES FONDS À UN AUTRE UTILISATEUR
  async transferFunds(
    fromUserId: string,
    toUserId: string,
    amount: number,
    description?: string,
  ) {
    const session = await this.userModel.startSession();
    session.startTransaction();

    try {
      // Vérifier que l'utilisateur ne se transfère pas à lui-même
      if (fromUserId === toUserId) {
        throw new BadRequestException('Impossible de transférer des fonds à vous-même');
      }

      const [fromUser, toUser] = await Promise.all([
        this.userModel.findById(fromUserId).session(session),
        this.userModel.findById(toUserId).session(session),
      ]);

      if (!fromUser) {
        throw new NotFoundException('Utilisateur expéditeur non trouvé');
      }
      if (!toUser) {
        throw new NotFoundException('Utilisateur destinataire non trouvé');
      }

      // ✅ Vérifier le solde
      if ((fromUser.balance || 0) < amount) {
        throw new BadRequestException('Solde insuffisant pour effectuer le transfert');
      }

      if (amount <= 0) {
        throw new BadRequestException('Le montant du transfert doit être positif');
      }

      // ✅ Créer les transactions (débit pour l'expéditeur, crédit pour le destinataire)
      const transactions = await this.transactionModel.create([
        {
          user_id: new Types.ObjectId(fromUserId),
          type: TransactionType.TRANSFER,
          amount: -amount,
          status: TransactionStatus.PENDING,
          balance_before: fromUser.balance || 0,
          description: description || `Transfert vers ${toUser.full_name || toUser.username}`,
          metadata: {
            to_user_id: toUserId,
            transfer_type: 'outgoing',
          },
        },
        {
          user_id: new Types.ObjectId(toUserId),
          type: TransactionType.TRANSFER,
          amount: amount,
          status: TransactionStatus.PENDING,
          balance_before: toUser.balance || 0,
          description: description || `Transfert de ${fromUser.full_name || fromUser.username}`,
          metadata: {
            from_user_id: fromUserId,
            transfer_type: 'incoming',
          },
        },
      ], { session });

      const [debitTransaction, creditTransaction] = transactions;

      // ✅ Mettre à jour les soldes
      fromUser.balance = (fromUser.balance || 0) - amount;
      toUser.balance = (toUser.balance || 0) + amount;

      await fromUser.save({ session });
      await toUser.save({ session });

      // ✅ Marquer les transactions comme complétées
      await Promise.all([
        this.transactionModel.findByIdAndUpdate(
          debitTransaction._id,
          {
            status: TransactionStatus.COMPLETED,
            balance_after: fromUser.balance,
            completed_at: new Date(),
          },
          { session }
        ),
        this.transactionModel.findByIdAndUpdate(
          creditTransaction._id,
          {
            status: TransactionStatus.COMPLETED,
            balance_after: toUser.balance,
            completed_at: new Date(),
          },
          { session }
        ),
      ]);

      await session.commitTransaction();

      this.logger.log(`✅ Transfert réussi: ${amount} USD de ${fromUserId} vers ${toUserId}`);

      return {
        success: true,
        amount: amount,
        from_user: {
          user_id: fromUserId,
          new_balance: fromUser.balance,
        },
        to_user: {
          user_id: toUserId,
          new_balance: toUser.balance,
        },
        transactions: {
          debit_transaction_id: debitTransaction.transaction_id,
          credit_transaction_id: creditTransaction.transaction_id,
        },
      };

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`❌ Erreur transfert de fonds: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ✅ RETIRER DES FONDS
async withdrawFunds(
  userId: string,
  amount: number,
  withdrawalMethod: string,
  accountDetails: string,
) {
  try {
    console.log(`💰 [DEBUG] Retrait demandé: ${amount} par user ${userId}`);
    
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // ✅ DEBUG: Afficher le solde exact
    console.log(`💰 [DEBUG] Solde actuel: ${user.balance || 0}`);
    console.log(`💰 [DEBUG] Montant demandé: ${amount}`);
    console.log(`💰 [DEBUG] Suffisant ? ${(user.balance || 0) >= amount}`);

    // ✅ Vérifier le solde
    if ((user.balance || 0) < amount) {
      throw new BadRequestException(
        `Solde insuffisant pour effectuer le retrait. Solde: ${user.balance || 0}, Montant demandé: ${amount}`
      );
    }

    if (amount < 10) {
      throw new BadRequestException('Le montant minimum de retrait est de 10 USD');
    }

    if (amount > 5000) {
      throw new BadRequestException('Le montant maximum de retrait est de 5000 USD');
    }

    // ✅ Méthodes de retrait supportées
    const supportedMethods = ['bank_transfer', 'mobile_money'];
    if (!supportedMethods.includes(withdrawalMethod)) {
      throw new BadRequestException(`Méthode de retrait non supportée. Méthodes disponibles: ${supportedMethods.join(', ')}`);
    }

    // ✅ Calculer les nouveaux soldes
    const balance_before = user.balance || 0;
    const balance_after = balance_before - amount;

    // ✅ Créer la transaction de retrait
    const transaction = await this.transactionModel.create({
      user_id: new Types.ObjectId(userId),
      type: TransactionType.WITHDRAWAL,
      amount: -amount,
      status: TransactionStatus.COMPLETED,
      balance_before: balance_before,
      balance_after: balance_after,
      description: `Retrait via ${withdrawalMethod}`,
      metadata: {
        withdrawal_method: withdrawalMethod,
        account_details: accountDetails,
      },
      completed_at: new Date(),
    });

    // ✅ Débiter le wallet
    user.balance = balance_after;
    await user.save();

    console.log(`✅ [DEBUG] Retrait réussi. Nouveau solde: ${user.balance}`);

    return {
      success: true,
      amount: amount,
      withdrawal_method: withdrawalMethod,
      transaction_id: transaction.transaction_id,
      new_balance: user.balance,
      processing_time: '2-3 jours ouvrables',
    };

  } catch (error) {
    console.error(`❌ [DEBUG] Erreur retrait: ${error.message}`);
    this.logger.error(`❌ Erreur retrait de fonds: ${error.message}`);
    throw error;
  }
}

  // ✅ APPLIQUER DES FRAIS DE SERVICE
  async applyServiceFee(
    userId: string,
    amount: number,
    reason: string,
    orderId?: string,
  ) {
    const session = await this.userModel.startSession();
    session.startTransaction();

    try {
      const user = await this.userModel.findById(userId).session(session);
      if (!user) {
        throw new NotFoundException('Utilisateur non trouvé');
      }

      // ✅ Vérifier le solde
      if ((user.balance || 0) < amount) {
        throw new BadRequestException('Solde insuffisant pour appliquer les frais');
      }

      // ✅ Créer la transaction de frais
      const transactions = await this.transactionModel.create([{
        user_id: new Types.ObjectId(userId),
        type: TransactionType.FEE,
        amount: -amount,
        status: TransactionStatus.PENDING,
        balance_before: user.balance || 0,
        order_id: orderId ? new Types.ObjectId(orderId) : undefined,
        description: `Frais de service: ${reason}`,
      }], { session });

      const transaction = transactions[0];

      // ✅ Débiter le wallet
      user.balance = (user.balance || 0) - amount;
      await user.save({ session });

      // ✅ Marquer la transaction comme complétée
      const completedTransaction = await this.transactionModel
        .findByIdAndUpdate(
          transaction._id,
          {
            status: TransactionStatus.COMPLETED,
            balance_after: user.balance,
            completed_at: new Date(),
          },
          { new: true, session }
        );

      if (!completedTransaction) {
        throw new InternalServerErrorException('Erreur lors de la mise à jour de la transaction');
      }

      await session.commitTransaction();

      this.logger.log(`✅ Frais appliqués: ${amount} USD pour user ${userId} - ${reason}`);

      return completedTransaction;

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`❌ Erreur application frais: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }

  // ✅ OBTENIR L'HISTORIQUE DES TRANSACTIONS
async getTransactionHistory(userId: string, page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;
  
  console.log(`🔍 [DEBUG] getTransactionHistory - Recherche pour userId: ${userId}`);
  
  try {
    // ✅ OPTION 1: Recherche avec ObjectId
    let query = {};
    
    if (Types.ObjectId.isValid(userId)) {
      const objectId = new Types.ObjectId(userId);
      query = { user_id: objectId };
      console.log(`🔍 [DEBUG] Recherche avec ObjectId:`, objectId);
    } else {
      // ✅ OPTION 2: Recherche comme string
      query = { user_id: userId };
      console.log(`🔍 [DEBUG] Recherche comme string:`, userId);
    }
    
    console.log(`🔍 [DEBUG] Query final:`, JSON.stringify(query));
    
    // ✅ COMPTER
    const total = await this.transactionModel.countDocuments(query);
    console.log(`📊 [DEBUG] Nombre de transactions trouvées: ${total}`);
    
    if (total === 0) {
      // ✅ VÉRIFIER TOUTES LES TRANSACTIONS POUR DEBUG
      const allTransactions = await this.transactionModel
        .find({})
        .limit(5)
        .select('user_id transaction_id amount')
        .lean();
      
      console.log(`🔍 [DEBUG] 5 transactions aléatoires:`, allTransactions);
      
      // ✅ VÉRIFIER L'UTILISATEUR
      const user = await this.userModel.findById(userId);
      console.log(`👤 [DEBUG] Utilisateur trouvé:`, user ? user._id : 'NON TROUVÉ');
    }
    
    // ✅ RÉCUPÉRER LES TRANSACTIONS
    const transactions = await this.transactionModel
      .find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v')
      .lean()
      .exec();
    
    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error(`❌ [DEBUG] Erreur:`, error);
    throw error;
  }
}
// ✅ MÉTHODE DE DEBUG
private async debugUserTransactions(userId: string) {
  try {
    console.log(`🔍 [DEBUG] Recherche alternative pour user: ${userId}`);
    
    // 1. Recherche sans ObjectId (juste en string)
    const asString = await this.transactionModel.find({ user_id: userId }).limit(5);
    console.log(`📊 [DEBUG] Recherche comme string: ${asString.length} résultats`);
    
    // 2. Recherche avec regex
    const asRegex = await this.transactionModel.find({
      user_id: { $regex: userId, $options: 'i' }
    }).limit(5);
    console.log(`📊 [DEBUG] Recherche avec regex: ${asRegex.length} résultats`);
    
    // 3. Voir la structure d'une transaction
    const sample = await this.transactionModel.findOne({});
    if (sample) {
      console.log(`📊 [DEBUG] Exemple de transaction:`, {
        id: sample._id,
        user_id: sample.user_id,
        type: sample.user_id?.constructor?.name
      });
    }
    
  } catch (error) {
    console.error(`❌ [DEBUG] Erreur debug:`, error);
  }
}
// src/modules/wallet/wallet.service.ts

// ✅ TRANSFÉRER LES FONDS POUR UNE COMMANDE (Client → Restaurant)
async transferFundsForOrder(
  fromUserId: string,      // Client qui paie
  toRestaurantId: string,  // Restaurant qui reçoit
  amount: number,
  description?: string,
): Promise<any> {
  const session = await this.userModel.startSession();
  session.startTransaction();

  try {
    // Vérifier que ce n'est pas un transfert à soi-même
    if (fromUserId === toRestaurantId) {
      throw new BadRequestException('Impossible de transférer à soi-même');
    }

    const [client, restaurant] = await Promise.all([
      this.userModel.findById(fromUserId).session(session),
      this.userModel.findById(toRestaurantId).session(session),
    ]);

    if (!client) {
      throw new NotFoundException('Client non trouvé');
    }
    if (!restaurant) {
      throw new NotFoundException('Restaurant non trouvé');
    }

    // ✅ Vérifier que le client a assez d'argent
    const clientBalance = client.balance || 0;
    if (clientBalance < amount) {
      throw new BadRequestException(`Solde client insuffisant: ${clientBalance} < ${amount}`);
    }

    if (amount <= 0) {
      throw new BadRequestException('Montant invalide');
    }

    // ✅ 1. Transaction pour le CLIENT (débit)
    const clientTransactions = await this.transactionModel.create([{
      user_id: new Types.ObjectId(fromUserId),
      type: TransactionType.PAYMENT,
      amount: -amount, // Négatif pour un débit
      status: TransactionStatus.COMPLETED,
      balance_before: clientBalance,
      description: description || 'Paiement restaurant',
      metadata: {
        to_restaurant_id: toRestaurantId,
        transfer_type: 'order_payment',
      },
      completed_at: new Date(),
    }], { session });

    // ✅ 2. Transaction pour le RESTAURANT (crédit)
    const restaurantTransactions = await this.transactionModel.create([{
      user_id: new Types.ObjectId(toRestaurantId),
      type: TransactionType.DEPOSIT,
      amount: amount, // Positif pour un crédit
      status: TransactionStatus.COMPLETED,
      balance_before: restaurant.balance || 0,
      description: description || 'Paiement client',
      metadata: {
        from_user_id: fromUserId,
        transfer_type: 'order_receipt',
      },
      completed_at: new Date(),
    }], { session });

    const clientTransaction = clientTransactions[0];
    const restaurantTransaction = restaurantTransactions[0];

    // ✅ 3. Mettre à jour les soldes
    client.balance = clientBalance - amount;
    restaurant.balance = (restaurant.balance || 0) + amount;

    await client.save({ session });
    await restaurant.save({ session });

    // ✅ 4. Mettre à jour les soldes finaux dans les transactions
    clientTransaction.balance_after = client.balance;
    restaurantTransaction.balance_after = restaurant.balance;

    await clientTransaction.save({ session });
    await restaurantTransaction.save({ session });

    await session.commitTransaction();

    this.logger.log(`✅ Transfert commande réussi: ${amount} TND de ${fromUserId} vers ${toRestaurantId}`);

    return {
      success: true,
      amount: amount,
      client: {
        user_id: fromUserId,
        new_balance: client.balance,
        transaction_id: clientTransaction.transaction_id,
      },
      restaurant: {
        user_id: toRestaurantId,
        new_balance: restaurant.balance,
        transaction_id: restaurantTransaction.transaction_id,
      },
    };

  } catch (error) {
    await session.abortTransaction();
    this.logger.error(`❌ Erreur transfert commande: ${error.message}`);
    throw error;
  } finally {
    session.endSession();
  }
}
  // ✅ OBTENIR LES STATISTIQUES DU WALLET
  async getWalletStats(userId: string) {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('Utilisateur non trouvé');
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());

      const stats = await this.transactionModel.aggregate([
        {
          $match: {
            user_id: new Types.ObjectId(userId),
            status: TransactionStatus.COMPLETED,
          },
        },
        {
          $facet: {
            totalTransactions: [
              { $count: 'count' },
            ],
            monthlyStats: [
              {
                $match: {
                  created_at: { $gte: startOfMonth },
                },
              },
              {
                $group: {
                  _id: '$type',
                  count: { $sum: 1 },
                  totalAmount: { $sum: '$amount' },
                },
              },
            ],
            weeklyStats: [
              {
                $match: {
                  created_at: { $gte: startOfWeek },
                },
              },
              {
                $group: {
                  _id: '$type',
                  count: { $sum: 1 },
                  totalAmount: { $sum: '$amount' },
                },
              },
            ],
            recentActivity: [
              { $sort: { created_at: -1 } },
              { $limit: 5 },
              {
                $project: {
                  type: 1,
                  amount: 1,
                  description: 1,
                  created_at: 1,
                },
              },
            ],
          },
        },
      ]);

      return {
        balance: user.balance || 0,
        currency: user.currency || 'TND',
        total_transactions: stats[0]?.totalTransactions[0]?.count || 0,
        monthly_stats: stats[0]?.monthlyStats || [],
        weekly_stats: stats[0]?.weeklyStats || [],
        recent_activity: stats[0]?.recentActivity || [],
      };
    } catch (error) {
      this.logger.error(`❌ Erreur récupération statistiques wallet: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la récupération des statistiques');
    }
  }

  // ✅ OBTENIR LE SOLDE
  async getBalance(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('balance currency stripe_customer_id')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    return {
      balance: user.balance || 0,
      currency: user.currency || 'TND',
      formatted_balance: `${user.balance || 0} ${user.currency || 'TND'}`,
      has_stripe_account: !!user.stripe_customer_id,
    };
  }

  // ✅ INITIALISER STRIPE POUR UN UTILISATEUR
  async initializeStripeAccount(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (user.stripe_customer_id) {
      return { 
        customer_id: user.stripe_customer_id,
        message: 'Compte Stripe déjà existant'
      };
    }

    const stripeCustomerId = await this.stripeService.createCustomer({
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
    });

    user.stripe_customer_id = stripeCustomerId;
    await user.save();

    return {
      customer_id: stripeCustomerId,
      message: 'Compte Stripe créé avec succès'
    };
  }

  // ✅ VÉRIFIER SI UN UTILISATEUR PEUT EFFECTUER UN PAIEMENT
  async canMakePayment(userId: string, amount: number): Promise<boolean> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        return false;
      }

      return (user.balance || 0) >= amount;
    } catch (error) {
      this.logger.error(`❌ Erreur vérification solde: ${error.message}`);
      return false;
    }
  }

  // ✅ ANNULER UNE TRANSACTION EN ATTENTE
  async cancelPendingTransaction(transactionId: string, userId: string) {
    const session = await this.userModel.startSession();
    session.startTransaction();

    try {
      const transaction = await this.transactionModel.findOne({
        transaction_id: transactionId,
        user_id: new Types.ObjectId(userId),
      }).session(session);

      if (!transaction) {
        throw new NotFoundException('Transaction non trouvée');
      }

      if (transaction.status !== TransactionStatus.PENDING) {
        throw new BadRequestException('Seules les transactions en attente peuvent être annulées');
      }

      // Annuler la transaction
      const cancelledTransaction = await this.transactionModel
        .findOneAndUpdate(
          { transaction_id: transactionId },
          {
            status: TransactionStatus.CANCELLED,
            failed_at: new Date(),
            failure_reason: 'Annulé par l\'utilisateur',
          },
          { new: true, session }
        );

      await session.commitTransaction();

      this.logger.log(`✅ Transaction annulée: ${transactionId}`);

      return cancelledTransaction;

    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`❌ Erreur annulation transaction: ${error.message}`);
      throw error;
    } finally {
      session.endSession();
    }
  }
  // src/modules/wallet/wallet.service.ts
async verifyAndCreditPayment(paymentIntentId: string, userId: string) {
  try {
    console.log(`🔍 [VERIFY] Vérification Payment Intent: ${paymentIntentId}`);
    
    // 1. Trouver la transaction associée
    const existingTransaction = await this.transactionModel.findOne({
      stripe_payment_intent_id: paymentIntentId,
      user_id: new Types.ObjectId(userId)
    });

    if (!existingTransaction) {
      console.log(`❌ [VERIFY] Transaction non trouvée pour PI: ${paymentIntentId}`);
      
      // Essayer de créer une nouvelle transaction
      return await this.creditWalletFromStripe(paymentIntentId, userId);
    }

    console.log(`📊 [VERIFY] Transaction trouvée:`, {
      id: existingTransaction.transaction_id,
      status: existingTransaction.status,
      amount: existingTransaction.amount
    });

    // Si déjà complétée, retourner
    if (existingTransaction.status === TransactionStatus.COMPLETED) {
      console.log(`⚠️ [VERIFY] Transaction déjà créditée`);
      return existingTransaction;
    }

    // 2. Vérifier le statut avec Stripe
    const paymentIntent = await this.stripeService.getPaymentIntent(paymentIntentId);
    console.log(`📊 [VERIFY] Statut Stripe: ${paymentIntent.status}`);
    
    if (paymentIntent.status === 'succeeded') {
      const amount = paymentIntent.amount / 100;
      console.log(`✅ [VERIFY] Paiement réussi: ${amount} USD`);
      
      // 3. Créditer le wallet
      return await this.creditWalletAfterPayment(userId, amount, paymentIntentId);
    } else {
      console.warn(`⚠️ [VERIFY] Payment Intent pas encore réussi: ${paymentIntent.status}`);
      throw new BadRequestException(`Paiement en statut: ${paymentIntent.status}. Attendez qu'il soit "succeeded".`);
    }
  } catch (error) {
    console.error(`❌ [VERIFY] Erreur:`, error.message);
    throw error;
  }
}

// Ajoutez cette méthode dans le service
async creditWalletFromStripe(paymentIntentId: string, userId: string) {
  try {
    console.log(`🔄 [CREDIT] Crédit depuis Stripe sans transaction existante`);
    
    const paymentIntent = await this.stripeService.getPaymentIntent(paymentIntentId);
    
    if (paymentIntent.status === 'succeeded') {
      const amount = paymentIntent.amount / 100;
      
      // Créer transaction et créditer
      return await this.creditWalletAfterPayment(userId, amount, paymentIntentId);
    } else {
      throw new BadRequestException(`Paiement non complété: ${paymentIntent.status}`);
    }
  } catch (error) {
    console.error(`❌ [CREDIT] Erreur:`, error);
    throw error;
  }
}
}