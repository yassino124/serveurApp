import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MessagerieService } from './messagerie.service';
import { MessagerieController } from './messagerie.controller';
import { MessagerieGateway } from './messagerie.gateway';
import {
  Message,
  MessageSchema,
  Conversation,
  ConversationSchema,
} from './message.schema';
import { User, UserSchema } from '../users/user.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/restaurant.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: User.name, schema: UserSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
    ]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
    }),
  ],
  controllers: [MessagerieController],
  providers: [MessagerieService, MessagerieGateway],
  exports: [MessagerieService],
})
export class MessagerieModule {}

