// src/modules/wallet/dto/deposit-to-wallet.dto.ts
import { IsNumber, IsPositive, Max, Min, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DepositToWalletDto {
  @ApiProperty({
    description: 'Montant à déposer',
    minimum: 1,
    maximum: 10000,
    example: 100
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  @Max(10000)
  amount: number;

  @ApiProperty({
    description: 'ID de la méthode de paiement Stripe',
    example: 'pm_1ABC123...'
  })
  @IsString()
  payment_method_id: string;
}