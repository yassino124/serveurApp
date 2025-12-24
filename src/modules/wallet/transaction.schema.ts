// src/modules/wallet/transaction.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type TransactionDocument = Transaction & Document;

export enum TransactionType {
  DEPOSIT = 'deposit',
  PAYMENT = 'payment',
  REFUND = 'refund',
  WITHDRAWAL = 'withdrawal',
  TRANSFER = 'transfer',
  FEE = 'fee',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Transaction {
  @Prop({ type: String, default: uuidv4, unique: true })
  transaction_id: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user_id: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, enum: TransactionType, required: true })
  type: TransactionType;

  @Prop({ type: String, enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  @Prop({ required: true })
  amount: number;

  @Prop({ default: 'TND' })
  currency: string;

  @Prop()
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order' })
  order_id?: MongooseSchema.Types.ObjectId;

  @Prop()
  stripe_payment_intent_id?: string;

  @Prop()
  stripe_charge_id?: string;

  @Prop()
  stripe_transfer_id?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ default: 0 })
  balance_before: number;

  @Prop({ default: 0 })
  balance_after: number;

  @Prop()
  completed_at?: Date;

  @Prop()
  failed_at?: Date;

  @Prop()
  failure_reason?: string;

  created_at: Date;
  updated_at: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ user_id: 1, created_at: -1 });
TransactionSchema.index({ transaction_id: 1 });
TransactionSchema.index({ stripe_payment_intent_id: 1 });
TransactionSchema.index({ order_id: 1 });
TransactionSchema.index({ type: 1, status: 1 });