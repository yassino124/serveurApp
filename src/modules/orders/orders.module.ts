import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from './order.schema';
import { Reel, ReelSchema } from '../reels/reel.schema';
import { User, UserSchema } from '../users/user.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/restaurant.schema';
import { OrdersGateway } from '../websocket/orders.gateway';
import { WalletModule } from '../wallet/wallet.module';
import { MessagesModule } from '../messages/messages.module';
import { StripeService } from '../stripe/stripe.service'; // ← AJOUTE CET IMPORT
import { StripeModule } from '../stripe/stripe.module'; // ← AJOUTE CET IMPORT

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Reel.name, schema: ReelSchema },
      { name: User.name, schema: UserSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'defaultSecretKeyForDevelopment',
        signOptions: { expiresIn: '24h' },
      }),
    }),
    WalletModule,
    MessagesModule,
    StripeModule, // ← AJOUTE CETTE LIGNE
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService, 
    OrdersGateway,
    StripeService, // ← AJOUTE CE PROVIDER
  ],
  exports: [OrdersService],
})
export class OrdersModule {}