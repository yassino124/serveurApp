import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
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
  PENDING_DELETION ='pending_deletion',
}

// ✅ Catégories de cuisine pour PlateNet (Réseau social culinaire)
export enum CuisineCategory {
  // Cuisines du monde
  TUNISIAN = 'tunisian',              // Cuisine tunisienne
  MEDITERRANEAN = 'mediterranean',    // Méditerranéenne
  ITALIAN = 'italian',                // Italienne
  FRENCH = 'french',                  // Française
  ASIAN = 'asian',                    // Asiatique
  MEXICAN = 'mexican',                // Mexicaine
  MIDDLE_EASTERN = 'middle_eastern',  // Moyen-Orient
  AMERICAN = 'american',              // Américaine
  INDIAN = 'indian',                  // Indienne
  JAPANESE = 'japanese',              // Japonaise
  
  // Types de plats
  SEAFOOD = 'seafood',                // Fruits de mer
  MEAT = 'meat',                      // Viandes
  VEGETARIAN = 'vegetarian',          // Végétarien
  VEGAN = 'vegan',                    // Vegan
  PASTA = 'pasta',                    // Pâtes
  PIZZA = 'pizza',                    // Pizza
  BURGERS = 'burgers',                // Burgers
  SALADS = 'salads',                  // Salades
  SOUPS = 'soups',                    // Soupes
  GRILLED = 'grilled',                // Grillades
  
  // Catégories spéciales
  DESSERTS = 'desserts',              // Desserts
  PASTRIES = 'pastries',              // Pâtisserie
  BAKERY = 'bakery',                  // Boulangerie
  STREET_FOOD = 'street_food',        // Street food
  FAST_FOOD = 'fast_food',            // Fast food
  FINE_DINING = 'fine_dining',        // Gastronomie
  HOME_COOKING = 'home_cooking',      // Cuisine maison
  FUSION = 'fusion',                  // Fusion
  
  // Régimes et tendances
  HEALTHY = 'healthy',                // Healthy
  ORGANIC = 'organic',                // Bio
  GLUTEN_FREE = 'gluten_free',        // Sans gluten
  KETO = 'keto',                      // Keto
  LOW_CARB = 'low_carb',              // Low carb
  
  // Occasions
  BREAKFAST = 'breakfast',            // Petit-déjeuner
  BRUNCH = 'brunch',                  // Brunch
  LUNCH = 'lunch',                    // Déjeuner
  DINNER = 'dinner',                  // Dîner
  SNACKS = 'snacks',                  // Snacks
  DRINKS = 'drinks',                  // Boissons
  COCKTAILS = 'cocktails',            // Cocktails
  COFFEE = 'coffee',                  // Café
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

  // ✅ NOUVEAU : Catégories de cuisine préférées
  @Prop({ 
    type: [String], 
    enum: CuisineCategory,
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

  // ✅ NOUVEAU : Date de désactivation (pour traçabilité)
  @Prop()
  suspended_at?: Date;

  // ✅ Champs pour la suppression programmée
  @Prop()
  deletion_requested_at?: Date;

  @Prop()
  scheduled_deletion_date?: Date;

  created_at: Date;
  updated_at: Date;
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

}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ user_id: 1 });
UserSchema.index({ account_status: 1 });