// src/modules/stripe/stripe-webhook.controller.ts - VERSION COMPLÈTE CORRIGÉE
import {
  Controller,
  Post,
  Headers,
  Logger,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { StripeService } from './stripe.service';
import { WalletService } from '../wallet/wallet.service';
import { ReelsService } from '../reels/reels.service'; // ✅ AJOUT

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly walletService: WalletService,
    private readonly reelsService: ReelsService, // ✅ AJOUT
  ) {}

  @Post()
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    console.log('🔔 [WEBHOOK] Webhook Stripe appelé');
    console.log('📨 [WEBHOOK] Headers:', request.headers);
    console.log('📦 [WEBHOOK] Body length:', request.rawBody?.length);

    if (!signature) {
      console.error('❌ [WEBHOOK] Signature manquante');
      throw new BadRequestException('Signature manquante');
    }

    try {
      const rawBody = request.rawBody;
      if (!rawBody) {
        console.error('❌ [WEBHOOK] Raw body manquant');
        throw new BadRequestException('Raw body manquant');
      }

      const event = this.stripeService.verifyWebhookSignature(rawBody, signature);
      
      console.log('✅ [WEBHOOK] Événement vérifié:', event.type);
      console.log('🔑 [WEBHOOK] ID Événement:', event.id);
      console.log('📊 [WEBHOOK] Données complètes:', JSON.stringify(event.data.object, null, 2));

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;

        case 'charge.succeeded':
          await this.handleChargeSucceeded(event.data.object);
          break;

        default:
          console.log(`⚡ [WEBHOOK] Événement non géré: ${event.type}`);
      }

      return { received: true };

    } catch (error: any) {
      console.error('❌ [WEBHOOK] Erreur:', error.message);
      console.error('🔍 [WEBHOOK] Stack:', error.stack);
      throw new BadRequestException('Webhook invalide');
    }
  }

  private async handlePaymentIntentSucceeded(paymentIntent: any) {
    console.log('🎉 [WEBHOOK] Paiement réussi:', paymentIntent.id);
    console.log('💰 [WEBHOOK] Montant:', paymentIntent.amount / 100, paymentIntent.currency);
    console.log('📦 [WEBHOOK] Métadonnées:', JSON.stringify(paymentIntent.metadata, null, 2));
    console.log('👤 [WEBHOOK] Customer:', paymentIntent.customer);

    try {
      const metadata = paymentIntent.metadata || {};
      const paymentType = metadata.type;
      
      console.log('🔍 [WEBHOOK] Type de paiement:', paymentType);

      // ✅ CAS 1: REEL BOOST (Sponsoring)
      if (paymentType === 'reel_boost') {
        console.log('🚀 [WEBHOOK] Traitement: Reel Boost');
        
        const reelId = metadata.reel_id;
        if (!reelId) {
          console.error('❌ [WEBHOOK] reel_id manquant dans metadata');
          console.error('📦 [WEBHOOK] Metadata complète:', metadata);
          return;
        }

        console.log('📹 [WEBHOOK] Reel ID:', reelId);
        console.log('💳 [WEBHOOK] Payment Intent ID:', paymentIntent.id);

        // ✅ CONFIRMER LE BOOSTING DU REEL
        const result = await this.reelsService.confirmBoostPayment(
          paymentIntent.id,
          paymentIntent.charges?.data[0]?.receipt_url
        );

        console.log('✅ [WEBHOOK] Reel boosté avec succès!');
        console.log('📊 [WEBHOOK] Détails:', {
          reel_id: result.reel.reel_id,
          boost_status: result.reel.boost_status,
          boost_amount: result.reel.boost_details?.amount,
          expires_at: result.reel.boost_details?.expires_at,
        });

        return;
      }

      // ✅ CAS 2: WALLET RECHARGE (Rechargement)
      if (paymentType === 'wallet_deposit' || paymentType === 'wallet_recharge') {
        console.log('💰 [WEBHOOK] Traitement: Wallet Recharge');
        
        let userId = metadata.user_id;
        console.log('🔍 [WEBHOOK] User ID depuis metadata:', userId);

        // Fallback: chercher dans customer
        if (!userId && paymentIntent.customer) {
          console.log('🔍 [WEBHOOK] Recherche dans customer:', paymentIntent.customer);
          try {
            const customer = await this.stripeService.getCustomer(paymentIntent.customer);
            console.log('👤 [WEBHOOK] Customer trouvé:', customer.id);
            userId = customer.metadata?.user_id;
            console.log('🔍 [WEBHOOK] User ID depuis customer:', userId);
          } catch (customerError: any) {
            console.error('❌ [WEBHOOK] Erreur customer:', customerError.message);
          }
        }

        if (!userId) {
          console.error('❌ [WEBHOOK] User ID introuvable');
          console.error('📦 [WEBHOOK] Metadata:', metadata);
          console.error('👤 [WEBHOOK] Customer:', paymentIntent.customer);
          return;
        }

        const amount = paymentIntent.amount / 100;
        console.log('✅ [WEBHOOK] Créditation wallet:', userId, amount, 'USD');

        const result = await this.walletService.creditWalletAfterPayment(
          userId,
          amount,
          paymentIntent.id
        );

        console.log('💰 [WEBHOOK] Wallet crédité avec succès!');
        console.log('📊 [WEBHOOK] Nouveau solde:', result.new_balance);
        console.log('🔗 [WEBHOOK] Transaction ID:', result.transaction_id);

        return;
      }

      // ⚠️ TYPE INCONNU
      console.warn('⚠️ [WEBHOOK] Type de paiement inconnu:', paymentType);
      console.warn('📦 [WEBHOOK] Metadata complète:', metadata);

    } catch (error: any) {
      console.error('❌ [WEBHOOK] Erreur critique:', error.message);
      console.error('🔍 [WEBHOOK] Stack:', error.stack);
      
      // Ne pas bloquer le webhook en cas d'erreur
      // Stripe va réessayer automatiquement
    }
  }

  private async handleChargeSucceeded(charge: any) {
    console.log('⚡ [WEBHOOK] Charge réussie:', charge.id);
    console.log('🔗 [WEBHOOK] Payment Intent:', charge.payment_intent);
    
    try {
      const paymentIntentId = charge.payment_intent;
      if (!paymentIntentId) {
        console.warn('⚠️ [WEBHOOK] Charge sans payment_intent');
        return;
      }

      const paymentIntent = await this.stripeService.getPaymentIntent(paymentIntentId);
      await this.handlePaymentIntentSucceeded(paymentIntent);
      
    } catch (error: any) {
      console.error('❌ [WEBHOOK] Erreur charge:', error.message);
    }
  }

  private async handlePaymentIntentFailed(paymentIntent: any) {
    console.error('💥 [WEBHOOK] Paiement échoué:', paymentIntent.id);
    console.error('📋 [WEBHOOK] Erreur:', paymentIntent.last_payment_error);
    console.error('📦 [WEBHOOK] Metadata:', paymentIntent.metadata);

    // TODO: Notifier l'utilisateur de l'échec du paiement
    const metadata = paymentIntent.metadata || {};
    const paymentType = metadata.type;

    if (paymentType === 'reel_boost') {
      console.log('🚫 [WEBHOOK] Échec boosting reel:', metadata.reel_id);
      // TODO: Mettre à jour le statut du reel en "failed"
    }

    if (paymentType === 'wallet_deposit') {
      console.log('🚫 [WEBHOOK] Échec rechargement wallet:', metadata.user_id);
      // TODO: Notifier l'utilisateur
    }
  }
}