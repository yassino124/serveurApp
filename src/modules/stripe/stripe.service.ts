// src/modules/stripe/stripe.service.ts
import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private configService: ConfigService) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    
    if (!stripeSecretKey) {
      this.logger.warn('⚠️ STRIPE_SECRET_KEY non défini - utilisation mode développement');
      // Pour le développement, vous pouvez utiliser une clé test
      this.stripe = new Stripe('sk_test_...', {
        apiVersion: '2025-11-17.clover', // ✅ CORRECTION: Utiliser la même version partout
      });
    } else {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2025-11-17.clover', // ✅ CORRECTION: Version cohérente
      });
    }
  }
async getPaymentIntent(paymentIntentId: string) {
  try {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
  } catch (error: any) {
    this.logger.error(`❌ Erreur récupération Payment Intent: ${error.message}`);
    throw new InternalServerErrorException('Paiement non trouvé');
  }
}
async getCustomer(customerId: string): Promise<Stripe.Customer> {
  try {
    const customer = await this.stripe.customers.retrieve(customerId);
    
    // Vérifier que c'est bien un Customer et non un DeletedCustomer
    if (customer.deleted) {
      throw new Error('Customer has been deleted');
    }
    
    return customer as Stripe.Customer;
  } catch (error: any) {
    this.logger.error(`❌ Erreur récupération customer: ${error.message}`);
    throw new InternalServerErrorException('Customer non trouvé');
  }
}
  // ✅ CRÉER UN CUSTOMER STRIPE
  async createCustomer(user: any): Promise<string> {
    try {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.full_name,
        metadata: { 
          user_id: user.user_id,
          platform: 'PlateNet'
        },
      });

      this.logger.log(`✅ Customer Stripe créé: ${customer.id}`);
      return customer.id;

    } catch (error: any) {
      this.logger.error(`❌ Erreur création customer Stripe: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la création du compte de paiement');
    }
  }

  // ✅ CRÉER UN PAYMENT INTENT
async createPaymentIntent(
  amount: number,
  customerId: string,
  metadata: any = {}
) {
  try {
    const amountInCents = Math.round(amount * 100);
    
    // ✅ DEBUG DÉTAILLÉ
    console.log('🔍 [DEBUG] Données envoyées à Stripe:');
    console.log('💰 Montant:', amount, 'USD ->', amountInCents, 'cents');
    console.log('👤 Customer ID:', customerId);
    console.log('📦 Métadonnées COMPLÈTES:', JSON.stringify(metadata, null, 2));
    console.log('🔑 user_id dans metadata:', metadata.user_id);
    console.log('🏷️ Type:', metadata.type);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        user_id: metadata.user_id, // ← VÉRIFIEZ QUE C'EST BIEN LÀ
        transaction_id: metadata.transaction_id,
        type: 'reel_boost',
        platform: 'PlateNet',
        created_at: new Date().toISOString(),
      },
      description: `Recharge wallet PlateNet - ${amount} USD`,
    });

    console.log('✅ [DEBUG] Payment Intent créé avec ID:', paymentIntent.id);
    console.log('📋 [DEBUG] Métadonnées Stripe:', paymentIntent.metadata);

    return {
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount: amount,
    };

  } catch (error) {
    console.error('❌ [DEBUG] Erreur création Payment Intent:', error);
    throw error;
  }
}

  // ✅ CONFIRMER UN PAIEMENT
  async confirmPayment(paymentIntentId: string, paymentMethodId: string) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(
        paymentIntentId,
        { payment_method: paymentMethodId }
      );

      this.logger.log(`✅ Paiement confirmé: ${paymentIntentId}, Status: ${paymentIntent.status}`);
      
      return {
        status: paymentIntent.status,
        amount: paymentIntent.amount ? paymentIntent.amount / 100 : 0, // ✅ Sécurisé
        currency: paymentIntent.currency,
        payment_intent_id: paymentIntent.id,
      };

    } catch (error: any) {
      this.logger.error(`❌ Erreur confirmation paiement: ${error.message}`);
      throw new InternalServerErrorException('Erreur lors de la confirmation du paiement');
    }
  }

  // ✅ WEBHOOK: Vérifier la signature
  verifyWebhookSignature(payload: string | Buffer, signature: string) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not defined');
    }

    try {
      return this.stripe.webhooks.constructEvent(
        payload, 
        signature, 
        webhookSecret
      );
    } catch (error: any) {
      this.logger.error(`❌ Signature webhook invalide: ${error.message}`);
      throw new BadRequestException('Signature webhook invalide');
    }
  }

  // ✅ TESTER LA CONNEXION STRIPE
  async testConnection() {
    try {
      // Tester en récupérant le compte
      const balance = await this.stripe.balance.retrieve();
      this.logger.log('✅ Connexion Stripe réussie');
      
      return {
        connected: true,
        balance_available: balance.available[0]?.amount || 0,
        balance_pending: balance.pending[0]?.amount || 0,
        currency: balance.available[0]?.currency || 'usd',
      };
    } catch (error: any) {
      this.logger.error(`❌ Test connexion Stripe échoué: ${error.message}`);
      return {
        connected: false,
        error: error.message,
      };
    }
  }
}