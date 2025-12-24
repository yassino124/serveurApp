// src/modules/wallet/wallet.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  HttpStatus,
  UseGuards,
  Query,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { StripeService } from '../stripe/stripe.service';

// Import des DTOs
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { DepositToWalletDto } from './dto/deposit-to-wallet.dto';
import { PaginationParamsDto } from './dto/pagination-params.dto';
import { TransferFundsDto } from './dto/transfer-funds.dto';
import { WithdrawFundsDto } from './dto/withdraw-funds.dto';

// Import des Response DTOs
import { 
  WalletBalanceResponseDto,
  PaymentIntentResponseDto,
  TransactionsHistoryResponseDto
} from './dto/responses.dto';

// Import des types de transaction
import { Types } from 'mongoose';
import { TransactionType, TransactionStatus } from './transaction.schema';

@ApiTags('Wallet')
@Controller('api/wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly stripeService: StripeService,
  ) {}

  // ✅ CREATE PAYMENT INTENT
@Post('create-payment-intent')
async createPaymentIntent(
  @CurrentUser() user: any,
  @Body() createPaymentIntentDto: CreatePaymentIntentDto,
) {
  const userId = user.user_id;
  console.log('💳 [REEL] Création Payment Intent + Transaction - Montant:', createPaymentIntentDto.amount);

  try {
    // 1. Initialiser Stripe
    const stripeAccount = await this.walletService.initializeStripeAccount(userId);
    console.log('✅ [REEL] Stripe account:', stripeAccount);

    // 2. Vérifier l'utilisateur
    const userDoc = await this.walletService['userModel'].findById(userId);
    if (!userDoc) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    // 3. Créer une transaction PENDING
    const transaction = await this.walletService['transactionModel'].create({
      user_id: new Types.ObjectId(userId),
      type: TransactionType.DEPOSIT,
      amount: createPaymentIntentDto.amount,
      status: TransactionStatus.PENDING,
      balance_before: userDoc.balance || 0,
      description: `Recharge wallet via Stripe: ${createPaymentIntentDto.amount} ${createPaymentIntentDto.currency || 'USD'}`,
      currency: createPaymentIntentDto.currency || 'USD',
      created_at: new Date(),
    });

    console.log('✅ [REEL] Transaction créée:', transaction.transaction_id);

    // 4. Créer les métadonnées avec l'ID de transaction
    const metadata = {
      user_id: userId,
      transaction_id: transaction.transaction_id,
      type: 'wallet_deposit',
      platform: 'PlateNet',
      amount: createPaymentIntentDto.amount.toString(),
      currency: createPaymentIntentDto.currency || 'usd',
      timestamp: new Date().toISOString(),
    };

    console.log('📦 [REEL] Métadonnées envoyées à Stripe:', metadata);

    // 5. Créer le Payment Intent Stripe
    const paymentIntent = await this.stripeService.createPaymentIntent(
      createPaymentIntentDto.amount,
      stripeAccount.customer_id,
      metadata
    );

    // 6. Mettre à jour la transaction avec l'ID Stripe
    await this.walletService['transactionModel'].findByIdAndUpdate(
      transaction._id,
      {
        stripe_payment_intent_id: paymentIntent.payment_intent_id,
      }
    );

    console.log('✅ [REEL] Payment Intent créé:', paymentIntent.payment_intent_id);
    console.log('✅ [REEL] Transaction mise à jour avec ID Stripe');

    return {
      statusCode: HttpStatus.OK,
      message: 'Payment Intent créé avec succès',
      data: {
        ...paymentIntent,
        transaction_id: transaction.transaction_id,
        note: 'Complétez le paiement sur le frontend, puis appelez /verify-payment'
      },
    };

  } catch (error) {
    console.error('❌ [REEL] Erreur:', error);
    throw error;
  }
}

  // ✅ DEPOSIT TO WALLET
  @Post('deposit')
  @ApiOperation({ summary: 'Recharger son wallet avec Stripe' })
  @ApiResponse({ status: 200, description: 'Recharge initiée' })
  async deposit(
    @CurrentUser() user: any,
    @Body() depositToWalletDto: DepositToWalletDto,
  ) {
    const userId = user.userId || user._id || user.user_id;
    this.logger.log(`💰 Recharge wallet - User: ${userId}, Amount: ${depositToWalletDto.amount}`);
    
    try {
      const result = await this.walletService.depositToWallet(
        userId,
        depositToWalletDto.amount,
        depositToWalletDto.payment_method_id,
      );
      
      return {
        statusCode: HttpStatus.OK,
        message: 'Recharge initiée avec succès',
        data: result,
      };
    } catch (error) {
      this.logger.error(`❌ Erreur recharge wallet: ${error.message}`);
      throw error;
    }
  }

  // ✅ GET BALANCE
@Get('balance')
async getBalance(@CurrentUser() user: any) {
  const userId = user.user_id;
  console.log(`💰 [REAL] User ID: ${userId}`);
  
  const balance = await this.walletService.getBalance(userId);
  
  return {
    statusCode: HttpStatus.OK,
    message: 'Solde récupéré',
    data: balance,
    timestamp: Date.now()
  };
}

@Get('transactions')
async getTransactions(
  @CurrentUser() user: any,
  @Query() paginationParams: PaginationParamsDto,
) {
  const userId = user.user_id;
  
  const timestamp = Date.now();
  const params = {
    ...paginationParams,
    _t: timestamp
  };
  
  const history = await this.walletService.getTransactionHistory(
    userId,
    params.page,
    params.limit
  );
  
  return {
    statusCode: HttpStatus.OK,
    message: 'Transactions',
    data: history,
    timestamp: timestamp
  };
}

  // ✅ TRANSFER FUNDS
  @Post('transfer')
  @ApiOperation({ summary: 'Transférer des fonds à un autre utilisateur' })
  @ApiResponse({ status: 200, description: 'Transfert effectué' })
  async transferFunds(
    @CurrentUser() user: any,
    @Body() transferFundsDto: TransferFundsDto,
  ) {
    const userId = user.userId || user._id || user.user_id;
    this.logger.log(`🔄 Transfert de fonds - De: ${userId}, Vers: ${transferFundsDto.to_user_id}, Montant: ${transferFundsDto.amount}`);
    
    try {
      const result = await this.walletService.transferFunds(
        userId,
        transferFundsDto.to_user_id,
        transferFundsDto.amount,
        transferFundsDto.description
      );
      
      return {
        statusCode: HttpStatus.OK,
        message: 'Transfert effectué avec succès',
        data: result,
      };
    } catch (error) {
      this.logger.error(`❌ Erreur transfert de fonds: ${error.message}`);
      throw error;
    }
  }

  // ✅ WITHDRAW FUNDS
@Post('wallet-withdraw')
@ApiOperation({ summary: 'Retirer des fonds du wallet' })
@ApiResponse({ status: 200, description: 'Demande de retrait initiée' })
async withdrawFunds(
  @CurrentUser() user: any,
  @Body() withdrawFundsDto: WithdrawFundsDto,
) {
  const userId = user.userId || user._id || user.user_id;
  this.logger.log(`🏧 Demande de retrait - User: ${userId}, Montant: ${withdrawFundsDto.amount}`);
  
  try {
    const result = await this.walletService.withdrawFunds(
      userId,
      withdrawFundsDto.amount,
      withdrawFundsDto.withdrawal_method,
      withdrawFundsDto.account_details
    );
    
    return {
      statusCode: HttpStatus.OK,
      message: 'Demande de retrait initiée avec succès',
      data: result,
    };
  } catch (error) {
    this.logger.error(`❌ Erreur demande de retrait: ${error.message}`);
    throw error;
  }
}

@Post('verify-payment')
@ApiOperation({ summary: 'Vérifier manuellement un paiement' })
@ApiResponse({ status: 200, description: 'Paiement vérifié' })
async verifyPayment(
  @CurrentUser() user: any,
  @Body() body: { payment_intent_id: string },
) {
  const userId = user.userId || user._id || user.user_id;
  this.logger.log(`🔍 Vérification manuelle paiement - User: ${userId}, PI: ${body.payment_intent_id}`);

  try {
    const result = await this.walletService.verifyAndCreditPayment(
      body.payment_intent_id,
      userId
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Paiement vérifié et wallet crédité avec succès',
      data: result,
    };
  } catch (error) {
    this.logger.error(`❌ Erreur vérification paiement: ${error.message}`);
    throw error;
  }
}

  // ✅ INITIALIZE STRIPE
  @Post('initialize-stripe')
  @ApiOperation({ summary: 'Initialiser le compte Stripe' })
  @ApiResponse({ status: 200, description: 'Compte Stripe initialisé' })
  async initializeStripe(@CurrentUser() user: any) {
    const userId = user.userId || user._id || user.user_id;
    this.logger.log(`🔧 Initialisation Stripe - User: ${userId}`);
    
    try {
      const result = await this.walletService.initializeStripeAccount(userId);
      
      return {
        statusCode: HttpStatus.OK,
        message: 'Compte Stripe initialisé avec succès',
        data: result,
      };
    } catch (error) {
      this.logger.error(`❌ Erreur initialisation Stripe: ${error.message}`);
      throw error;
    }
  }

// ✅ ADD FUNDS MANUAL
@Post('add-funds-manual')
@ApiOperation({ summary: 'Ajouter des fonds manuellement (pour tests)' })
async addFundsManual(
  @CurrentUser() user: any,
  @Body() body: { amount: number }
) {
  const userId = user.user_id;
  
  console.log(`💰 [ADD FUNDS] Ajout manuel de ${body.amount} pour user ${userId}`);
  
  try {
    const userDoc = await this.walletService['userModel'].findById(userId);
    if (!userDoc) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    const balance_before = userDoc.balance || 0;
    const amount = body.amount || 100;
    const balance_after = balance_before + amount;

    // Créer la transaction
    const transaction = await this.walletService['transactionModel'].create({
      user_id: new Types.ObjectId(userId),
      type: TransactionType.DEPOSIT,
      amount: amount,
      status: TransactionStatus.COMPLETED,
      balance_before: balance_before,
      balance_after: balance_after,
      description: `Ajout manuel: ${amount} USD`,
      completed_at: new Date(),
    });

    // Mettre à jour le solde
    userDoc.balance = balance_after;
    await userDoc.save();

    console.log(`✅ [ADD FUNDS] Solde mis à jour: ${balance_before} → ${balance_after}`);

    return {
      success: true,
      amount: amount,
      previous_balance: balance_before,
      new_balance: balance_after,
      transaction_id: transaction.transaction_id,
      message: `✅ ${amount} USD ajoutés au wallet`
    };

  } catch (error) {
    console.error('❌ [ADD FUNDS] Erreur:', error);
    throw error;
  }
}

// ✅ DEBUG STATE
@Get('debug-state')
async debugState(@CurrentUser() user: any) {
  const userId = user.user_id;
  
  try {
    // 1. Informations utilisateur
    const userDoc = await this.walletService['userModel'].findById(userId)
      .select('_id balance currency email full_name stripe_customer_id')
      .lean();
    
    // 2. Toutes les transactions
    const allTransactions = await this.walletService['transactionModel']
      .find({ user_id: new Types.ObjectId(userId) })
      .sort({ created_at: -1 })
      .select('transaction_id type amount status created_at stripe_payment_intent_id')
      .lean();
    
    // 3. Transactions PENDING
    const pendingTransactions = allTransactions.filter(t => t.status === TransactionStatus.PENDING);
    
    // 4. Transactions COMPLETED
    const completedTransactions = allTransactions.filter(t => t.status === TransactionStatus.COMPLETED);
    
    // 5. Calculer le solde théorique
    const theoreticalBalance = completedTransactions.reduce((sum, t) => sum + t.amount, 0);
    
    return {
      user: {
        ...userDoc,
        id: userDoc?._id?.toString()
      },
      balance_summary: {
        database: userDoc?.balance || 0,
        calculated_from_transactions: theoreticalBalance,
        difference: (userDoc?.balance || 0) - theoreticalBalance
      },
      transactions: {
        total: allTransactions.length,
        pending: pendingTransactions.length,
        completed: completedTransactions.length
      },
      pending_transactions: pendingTransactions.map(t => ({
        ...t,
        id: t._id?.toString()
      })),
      recent_transactions: allTransactions.slice(0, 5).map(t => ({
        ...t,
        id: t._id?.toString()
      })),
      can_withdraw_100: (userDoc?.balance || 0) >= 100,
      needs_action: pendingTransactions.length > 0 ? 
        'Utilisez /verify-payment pour compléter les transactions en attente' : 
        'Tout est bon'
    };
  } catch (error) {
    console.error('❌ [DEBUG] Erreur:', error);
    throw error;
  }
}
}