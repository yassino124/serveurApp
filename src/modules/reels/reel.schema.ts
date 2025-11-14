// src/reels/reel.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
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
}

export const ReelSchema = SchemaFactory.createForClass(Reel);

ReelSchema.index({ user_id: 1, created_at: -1 });
ReelSchema.index({ categories: 1, created_at: -1 });
ReelSchema.index({ hashtags: 1 });
ReelSchema.index({ status: 1, visibility: 1 });
ReelSchema.index({ likes_count: -1, created_at: -1 });
ReelSchema.index({ 'hashtags': 'text', 'caption': 'text' });