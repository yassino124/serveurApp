// restaurants.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { Restaurant, RestaurantSchema } from './restaurant.schema';
import { UsersModule } from '../users/users.module'; // ✅ importer UsersModule
import { Reel, ReelSchema } from '../reels/reel.schema'; // ✅ importer Reel
import { GeminiService } from './gemini.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Reel.name, schema: ReelSchema }, // ✅ pour vérifier les reels
    ]),
    UsersModule, // ✅ pour injecter UserModel
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService, GeminiService],
})
export class RestaurantsModule {}
