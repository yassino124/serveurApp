import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RestaurantDocument = Restaurant & Document;

// Sous-schéma pour les plats du menu
@Schema({ _id: false })
export class Dish {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop()
  price?: number;

  @Prop()
  image?: string;
}

@Schema({ timestamps: true })
export class Restaurant {
  @Prop({ unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  address: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  photos: string[];

  @Prop()
  predefinedPhoto?: string;

  @Prop({ required: true })
  ownerId: string;

  @Prop({ required: false })
  ownerUsername: string;

  @Prop({ type: Number, default: 0 })
  rating: number;

  @Prop({ type: [String], default: [] })
  reviews: string[];

  @Prop({ type: [Dish], default: [] })
  menu: Dish[];

  @Prop({ type: [String], default: [] })
  reels: string[];

  @Prop({ type: [String], default: [] })
  tags: string[];
}

export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);
RestaurantSchema.index({ ownerId: 1 });
RestaurantSchema.index({ ownerUsername: 1 });
