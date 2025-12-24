// wallet.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { StripeService } from '../stripe/stripe.service';
import { User, UserSchema } from '../users/user.schema';
import { Transaction, TransactionSchema } from './transaction.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [WalletController], // ✅ Doit être présent
  providers: [WalletService, StripeService],
  exports: [WalletService],
})
export class WalletModule {}