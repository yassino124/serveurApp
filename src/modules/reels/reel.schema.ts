// src/reels/reel.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { User, CuisineCategory } from '../users/user.schema';

export type ReelDocument = Reel & Document;

export enum ReelStatus {
  ACTIVE = 'active',
  DELETED = 'deleted',
  ARCHIVED = 'archived',
}

export enum ReelVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  FOLLOWERS_ONLY = 'followers_only',
}

export enum DeleteReason {
  NO_LONGER_RELEVANT = 'no_longer_relevant',
  PRIVACY_CONCERNS = 'privacy_concerns',
  QUALITY_ISSUES = 'quality_issues',
  COPYRIGHT_ISSUES = 'copyright_issues',
  DUPLICATE_CONTENT = 'duplicate_content',
  OTHER = 'other',
}

export enum BoostType {
  SPONSORED = 'sponsored',      // Sponsoring par l'utilisateur
  PROMOTED = 'promoted',        // Promotion par la plateforme
  ORGANIC = 'organic'           // Organique (non boosté)
}

export enum BoostStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Reel {
  @Prop({ type: String, default: uuidv4, unique: true })
  reel_id: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user_id: string;

  @Prop({ required: true })
  video_url: string;
  
  @Prop()
  thumbnail_url?: string;

  @Prop({ default: 0 })
  video_duration: number;

  @Prop({ required: true })
  caption: string;

  @Prop({ type: [String], default: [] })
  hashtags: string[];

  @Prop({ type: [String], enum: CuisineCategory, default: [] })
  categories: CuisineCategory[];

  @Prop()
  location?: string;

  @Prop({ default: 0 })
  likes_count: number;

  @Prop({ default: 0 })
  comments_count: number;

  @Prop({ default: 0 })
  shares_count: number;

  @Prop({ default: 0 })
  views_count: number;

  @Prop({ default: 0 })
  save_count: number;

  @Prop({ type: String, enum: ReelVisibility, default: ReelVisibility.PUBLIC })
  visibility: ReelVisibility;

  @Prop({ type: String, enum: ReelStatus, default: ReelStatus.ACTIVE })
  status: ReelStatus;

  @Prop({ default: false })
  ai_enhanced: boolean;

  @Prop()
  ai_caption?: string;

  @Prop({ type: [String], default: [] })
  ai_hashtags: string[];

  @Prop({ type: Object, default: {} })
  video_metadata?: {
    width?: number;
    height?: number;
    format?: string;
    size?: number;
    aspect_ratio?: string;
  };

  @Prop()
  music_track?: string;

  @Prop()
  music_artist?: string;

  @Prop({ default: false })
  is_flagged: boolean;

  @Prop({ type: [String], default: [] })
  flagged_reasons: string[];

  // ✅ AJOUT: Champs pour gérer les likes
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  liked_by: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  unliked_by: Types.ObjectId[];

  @Prop({ type: String, enum: DeleteReason })
  deletion_reason?: DeleteReason;

  @Prop()
  deletion_explanation?: string;

  @Prop()
  deleted_at?: Date;

  @Prop()
  archived_at?: Date;

  created_at: Date;
  updated_at: Date;
    // ✅ AJOUT: Champs pour gérer les commentaires
  @Prop({ type: [{
    _id: { type: Types.ObjectId, auto: true },
    user_id: { 
      type: Types.ObjectId, 
      ref: 'User',
      required: true 
    },
    text: { type: String, required: true },
    parent_comment_id: { 
      type: Types.ObjectId, 
      ref: 'Comment',
      default: null 
    },
    replies: [{
      _id: { type: Types.ObjectId, auto: true },
      user_id: { 
        type: Types.ObjectId, 
        ref: 'User',
        required: true 
      },
      text: { type: String, required: true },
      likes_count: { type: Number, default: 0 },
      created_at: { type: Date, default: Date.now }
    }],
    likes_count: { type: Number, default: 0 },
    user_has_liked: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
  }], default: [] })
  comments: {
    _id: Types.ObjectId;
    user_id: Types.ObjectId;
    text: string;
    parent_comment_id?: Types.ObjectId;
    replies?: {
      _id: Types.ObjectId;
      user_id: Types.ObjectId;
      text: string;
      likes_count: number;
      created_at: Date;
    }[];
    likes_count: number;
    user_has_liked: boolean;
    created_at: Date;
    updated_at: Date;
  }[];


  // ✅ AJOUT: Champs pour gérer les partages (avec _id)
  @Prop({ type: [{
    _id: { type: Types.ObjectId, auto: true },
    user_id: { type: Types.ObjectId, ref: 'User' },
    platform: String,
    shared_at: { type: Date, default: Date.now }
  }], default: [] })
  shared_by: {
    _id: Types.ObjectId;
    user_id: Types.ObjectId;
    platform: string;
    shared_at: Date;
  }[];
  
    @Prop({ 
    type: String, 
    enum: BoostType, 
    default: BoostType.ORGANIC 
  })
  boost_type: BoostType;

  @Prop({ 
    type: String, 
    enum: BoostStatus, 
    default: BoostStatus.PENDING 
  })
  boost_status: BoostStatus;

  @Prop({
    type: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: 'USD' },
      duration_days: { type: Number, default: 1 },
      max_impressions: { type: Number, default: 1000 },
      target_audience: { type: [String], default: [] },
      boosted_at: { type: Date },
      expires_at: { type: Date },
      stripe_payment_intent_id: { type: String },
      stripe_receipt_url: { type: String },
      metadata: { type: Object, default: {} }
    },
    default: {}
  })
  boost_details: {
    amount: number;
    currency: string;
    duration_days: number;
    max_impressions: number;
    target_audience: string[];
    boosted_at?: Date;
    expires_at?: Date;
    stripe_payment_intent_id?: string;
    stripe_receipt_url?: string;
    metadata?: any;
  };

  @Prop({ default: 0 })
  boosted_impressions: number;

  @Prop({ default: 0 })
  boosted_clicks: number;

  @Prop({ default: 0 })
  boosted_engagement: number;

  @Prop()
  last_boosted_at?: Date;

}

export const ReelSchema = SchemaFactory.createForClass(Reel);

ReelSchema.index({ user_id: 1, created_at: -1 });
ReelSchema.index({ categories: 1, created_at: -1 });
ReelSchema.index({ hashtags: 1 });
ReelSchema.index({ status: 1, visibility: 1 });
ReelSchema.index({ likes_count: -1, created_at: -1 });
ReelSchema.index({ 'hashtags': 'text', 'caption': 'text' });
// ✅ AJOUT: Index pour les champs de likes
ReelSchema.index({ 'liked_by': 1 });
ReelSchema.index({ 'unliked_by': 1 });
ReelSchema.index({ 'comments.user_id': 1 });
ReelSchema.index({ 'shared_by.user_id': 1 });
ReelSchema.index({ 'comments.created_at': -1 });
ReelSchema.index({ 'boost_status': 1, 'boost_details.expires_at': 1 });
ReelSchema.index({ 'boost_details.stripe_payment_intent_id': 1 });
ReelSchema.index({ 'boosted_impressions': -1 });
ReelSchema.index({ 'last_boosted_at': -1 });