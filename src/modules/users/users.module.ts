import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, UserSchema } from './user.schema';
import { Reel, ReelSchema } from '../reels/reel.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/restaurant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Reel.name, schema: ReelSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService , MongooseModule], // Pour l'utiliser dans d'autres modules si besoin
})
export class UsersModule {}