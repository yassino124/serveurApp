// src/modules/wallet/dto/responses.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class WalletBalanceResponseDto {
  @ApiProperty({ example: 150.50 })
  balance: number;

  @ApiProperty({ example: 'TND' })
  currency: string;

  @ApiProperty({ example: '150.50 TND' })
  formatted_balance: string;

  @ApiProperty({ example: true })
  has_stripe_account: boolean;
}

export class PaymentIntentResponseDto {
  @ApiProperty({ example: 'pi_1ABC123...' })
  payment_intent_id: string;

  @ApiProperty({ example: 'pi_1ABC123_secret_xyz' })
  client_secret: string;

  @ApiProperty({ example: 'requires_payment_method' })
  status: string;

  @ApiProperty({ example: 50 })
  amount: number;

  @ApiProperty({ example: 'usd' })
  currency: string;
}

export class TransactionResponseDto {
  @ApiProperty({ example: 'txn_123456' })
  transaction_id: string;

  @ApiProperty({ enum: ['deposit', 'payment', 'refund', 'withdrawal', 'transfer'] })
  type: string;

  @ApiProperty({ enum: ['pending', 'completed', 'failed', 'cancelled'] })
  status: string;

  @ApiProperty({ example: 50 })
  amount: number;

  @ApiProperty({ example: 'TND' })
  currency: string;

  @ApiProperty({ example: 'Recharge wallet via Stripe' })
  description: string;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  created_at: Date;
}

export class TransactionsHistoryResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  transactions: TransactionResponseDto[];

  @ApiProperty({
    example: {
      page: 1,
      limit: 20,
      total: 45,
      pages: 3
    }
  })
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}