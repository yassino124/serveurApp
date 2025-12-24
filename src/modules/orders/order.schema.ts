// src/modules/orders/order.schema.ts - VERSION COMPLÈTE

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type OrderDocument = Order & Document;

export enum OrderStatus {
  PENDING = 'pending',
  PENDING_PAYMENT = 'pending_payment',
  ACCEPTED = 'accepted',
  PREPARING = 'preparing',
  READY = 'ready',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CASH_ON_DELIVERY = 'cash_on_delivery',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export enum PaymentMethod {
  CASH = 'cash',
  WALLET = 'wallet',
  CARD = 'card',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Order {
  @Prop({ type: String, default: uuidv4, unique: true })
  order_id: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user_id: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Reel', required: true })
  reel_id: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  restaurant_id: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  dish_name: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ default: 0 })
  unit_price?: number;

  @Prop({ default: 0 })
  total_price: number;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Prop()
  customer_notes?: string;

  @Prop()
  cancellation_reason?: string;

  @Prop({ 
    type: String, 
    enum: PaymentMethod, 
    default: PaymentMethod.CASH 
  })
  payment_method: PaymentMethod;

  @Prop({ 
    type: String, 
    enum: PaymentStatus, 
    default: PaymentStatus.CASH_ON_DELIVERY 
  })
  payment_status: PaymentStatus;

  // ✅ AJOUT: Champ pour stocker le Payment Intent Stripe
  @Prop({ type: String })
  stripe_payment_intent_id?: string;

  @Prop()
  accepted_at?: Date;

  @Prop()
  preparing_at?: Date;

  @Prop()
  ready_at?: Date;

  @Prop()
  completed_at?: Date;

  @Prop()
  cancelled_at?: Date;

  @Prop()
  estimated_preparation_time?: number;

  @Prop()
  pickup_instructions?: string;

  created_at: Date;
  updated_at: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// ✅ INDEXES
OrderSchema.index({ user_id: 1, created_at: -1 });
OrderSchema.index({ restaurant_id: 1, status: 1 });
OrderSchema.index({ order_id: 1 });
OrderSchema.index({ status: 1, created_at: -1 });
OrderSchema.index({ payment_status: 1 });
OrderSchema.index({ payment_method: 1 });
OrderSchema.index({ stripe_payment_intent_id: 1 }); // ✅ Index pour recherche rapide