import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type MessageDocument = Message & Document;

export enum MessageType {
  ORDER_CREATED = 'order_created',
  ORDER_STATUS_UPDATED = 'order_status_updated',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_COMPLETED = 'order_completed', // ← NOUVEAU
  CUSTOMER_MESSAGE = 'customer_message',
  RESTAURANT_MESSAGE = 'restaurant_message',
  SYSTEM_NOTIFICATION = 'system_notification',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Message {
  @Prop({ type: String, default: uuidv4, unique: true })
  message_id: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  recipient_id: string; // Utilisateur qui reçoit le message

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  sender_id?: string; // Utilisateur qui envoie le message (optionnel pour les messages système)

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order' })
  order_id?: string; // Référence à la commande concernée

  @Prop({ type: String, enum: MessageType, required: true })
  message_type: MessageType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ default: false })
  is_read: boolean;

  @Prop()
  read_at?: Date;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>; // Données supplémentaires

  created_at: Date;
  updated_at: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ recipient_id: 1, created_at: -1 });
MessageSchema.index({ order_id: 1 });
MessageSchema.index({ is_read: 1 });
MessageSchema.index({ message_type: 1 });