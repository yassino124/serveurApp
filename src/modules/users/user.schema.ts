import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type UserDocument = User & Document;

export enum UserRole {
  USER = 'user',
  CHEF = 'chef',
  RESTAURANT = 'restaurant',
}

export enum AccountStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
  PENDING_DELETION = 'pending_deletion',
}

// ✅ Catégories de cuisine pour PlateNet
export enum CuisineCategory {
  TUNISIAN = 'tunisian',
  MEDITERRANEAN = 'mediterranean',
  ITALIAN = 'italian',
  FRENCH = 'french',
  ASIAN = 'asian',
  MEXICAN = 'mexican',
  MIDDLE_EASTERN = 'middle_eastern',
  AMERICAN = 'american',
  INDIAN = 'indian',
  JAPANESE = 'japanese',
  SEAFOOD = 'seafood',
  MEAT = 'meat',
  VEGETARIAN = 'vegetarian',
  VEGAN = 'vegan',
  PASTA = 'pasta',
  PIZZA = 'pizza',
  BURGERS = 'burgers',
  SALADS = 'salads',
  SOUPS = 'soups',
  GRILLED = 'grilled',
  DESSERTS = 'desserts',
  PASTRIES = 'pastries',
  BAKERY = 'bakery',
  STREET_FOOD = 'street_food',
  FAST_FOOD = 'fast_food',
  FINE_DINING = 'fine_dining',
  HOME_COOKING = 'home_cooking',
  FUSION = 'fusion',
  HEALTHY = 'healthy',
  ORGANIC = 'organic',
  GLUTEN_FREE = 'gluten_free',
  KETO = 'keto',
  LOW_CARB = 'low_carb',
  BREAKFAST = 'breakfast',
  BRUNCH = 'brunch',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACKS = 'snacks',
  DRINKS = 'drinks',
  COCKTAILS = 'cocktails',
  COFFEE = 'coffee',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class User {
  @Prop({ type: String, default: uuidv4, unique: true })
  user_id: string;

  @Prop({ unique: true, required: true, trim: true, lowercase: true })
  username: string;

  @Prop({ unique: true, required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true, select: false })
  password_hash: string;

  @Prop({ required: true })
  full_name: string;

  @Prop()
  profile_picture?: string;

  @Prop()
  bio?: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.PENDING })
  account_status: AccountStatus;

  // ✅ Catégories de cuisine préférées
  @Prop({ 
    type: [String], 
    enum: Object.values(CuisineCategory),
    default: [] 
  })
  preferred_categories: CuisineCategory[];

  @Prop({ type: Object, default: {} })
  preferences?: Record<string, any>;

  @Prop({ default: 0 })
  followers_count: number;

  @Prop({ default: 0 })
  following_count: number;

  @Prop({ default: 0 })
  posts_count: number;

  @Prop({ default: 0 })
  likes_received: number;
  @Prop({ default: 0 })
  total_likes_given: number;

  @Prop({ default: 0 })
  total_likes_received: number;

  @Prop({ default: 0 })
  total_comments_given: number;

  @Prop({ default: 0 })
  total_comments_received: number;

  @Prop({ default: 0 })
  total_shares_given: number;

  @Prop({ default: 0 })
  total_shares_received: number;
  // ✅ Date de désactivation (pour traçabilité)
  @Prop()
  suspended_at?: Date;

  // ✅ Champs pour la suppression programmée
  @Prop()
  deletion_requested_at?: Date;

  @Prop()
  scheduled_deletion_date?: Date;

  @Prop({ 
    type: String, 
    enum: ['local', 'google', 'apple'], 
    default: 'local' 
  })
  provider: string;

  @Prop({ unique: true, sparse: true })
  provider_id: string;

  @Prop({ default: false })
  email_verified: boolean;

  @Prop({ type: Object })
  social_data?: Record<string, any>;

  // ✅ Système de balance/wallet
  @Prop({ default: 0, min: 0 })
  balance: number;

  @Prop({ type: String, unique: true, sparse: true })
  stripe_customer_id?: string;

  @Prop({ type: String, unique: true, sparse: true })
  stripe_account_id?: string; // Pour les chefs/restaurants qui reçoivent des paiements

  @Prop({ type: Object, default: {} })
  payment_methods?: Record<string, any>;

  @Prop({ default: 'TND' })
  currency: string;

  // ✅ CORRECTION : Utiliser Types.ObjectId au lieu de MongooseSchema.Types.ObjectId
  @Prop([{ 
    type: Types.ObjectId, 
    ref: 'Transaction' 
  }])
  transactions?: Types.ObjectId[];

  created_at: Date;
  updated_at: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Index pour optimiser les requêtes
UserSchema.index({ email: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ user_id: 1 });
UserSchema.index({ account_status: 1 });
UserSchema.index({ stripe_customer_id: 1 });
UserSchema.index({ stripe_account_id: 1 });