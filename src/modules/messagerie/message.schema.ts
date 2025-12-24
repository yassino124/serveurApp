import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export enum ParticipantType {
  USER = 'user',
  RESTAURANT = 'restaurant',
}

export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
  SYSTEM = 'system',
}

@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({
    type: String,
    default: () => uuidv4(),
    unique: true,
    required: true,
  })
  message_id: string;

  @Prop({ required: true })
  conversation_id: string;

  @Prop({ required: true })
  sender_id: string;

  @Prop({ required: true, enum: ParticipantType })
  sender_type: ParticipantType;

  // Rendre optionnel car peut être déduit de la conversation
  @Prop({ required: false })
  recipient_id?: string;

  @Prop({ required: true })
  content: string;

  // Rendre title optionnel
  @Prop({ required: false })
  title?: string;

  // Type de message avec valeur par défaut
  @Prop({
    type: String,
    enum: MessageType,
    default: MessageType.TEXT,
    required: false,
  })
  message_type?: MessageType;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  @Prop({ required: false })
  reply_to_message_id?: string;

  @Prop({
    type: String,
    enum: MessageStatus,
    default: MessageStatus.SENT,
  })
  status: MessageStatus;

  @Prop({ default: false })
  is_deleted: boolean;

  @Prop({ required: false })
  deleted_at?: Date;

  @Prop({ default: false })
  is_edited: boolean;

  @Prop({ required: false })
  edited_at?: Date;

  // Timestamps automatiques de Mongoose
  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;
}

@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({
    type: String,
    default: () => uuidv4(),
    unique: true,
    required: true,
  })
  conversation_id: string;

  @Prop({ required: true })
  participant1_id: string;

  @Prop({ required: true, enum: ParticipantType })
  participant1_type: ParticipantType;

  @Prop({ required: true })
  participant2_id: string;

  @Prop({ required: true, enum: ParticipantType })
  participant2_type: ParticipantType;

  @Prop({ required: false })
  last_message_id?: string;

  @Prop({ required: false })
  last_message_content?: string;

  @Prop({ required: false })
  last_message_at?: Date;

  @Prop({ type: Map, of: Date, default: new Map() })
  last_read_at: Map<string, Date>;

  @Prop({ default: false })
  is_archived: boolean;

  @Prop({ required: false })
  archived_at?: Date;

  @Prop({ default: false })
  is_blocked: boolean;

  @Prop({ required: false })
  blocked_by?: string;

  // Timestamps automatiques
  @Prop()
  created_at: Date;

  @Prop()
  updated_at: Date;

  // Index composé pour recherche rapide des conversations
  @Prop({ index: true })
  compositeKey: string;

  // Méthode pour générer la clé composite
  public generateCompositeKey(): void {
    const participants = [this.participant1_id, this.participant2_id].sort();
    this.compositeKey = `${participants[0]}_${participants[1]}`;
  }
}

// Middleware pour générer la clé composite avant sauvegarde
const conversationSchema = SchemaFactory.createForClass(Conversation);
conversationSchema.pre('save', function (next) {
  const conversation = this as any;
  const participants = [
    conversation.participant1_id,
    conversation.participant2_id,
  ].sort();
  conversation.compositeKey = `${participants[0]}_${participants[1]}`;
  next();
});

export const MessageSchema = SchemaFactory.createForClass(Message);

// Ajouter des indexes pour optimiser les requêtes
MessageSchema.index({ conversation_id: 1, created_at: 1 });
MessageSchema.index({ sender_id: 1 });
MessageSchema.index({ recipient_id: 1 });
MessageSchema.index({ status: 1 });

conversationSchema.index({ compositeKey: 1 }, { unique: true });
conversationSchema.index({ participant1_id: 1 });
conversationSchema.index({ participant2_id: 1 });
conversationSchema.index({ last_message_at: -1 });

export { conversationSchema as ConversationSchema };
export type MessageDocument = Message & Document;
export type ConversationDocument = Conversation & Document;