// src/reels/reels.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReelsService } from './reels.service';
import { ReelsController } from './reels.controller';
import { Reel, ReelSchema } from './reel.schema';
import { User, UserSchema } from '../users/user.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/restaurant.schema';
import { ContentModerationService } from './content-moderation.service'; 
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reel.name, schema: ReelSchema },
      { name: User.name, schema: UserSchema },
      { name: Restaurant.name, schema: RestaurantSchema }, // ← Add Restaurant model here

    ]),
    forwardRef(() => StripeModule),
  ],
  controllers: [ReelsController],
  providers: [
    ReelsService, // ✅ DOIT être dans providers
    ContentModerationService,
  ],
  exports: [ReelsService],
})
export class ReelsModule {}