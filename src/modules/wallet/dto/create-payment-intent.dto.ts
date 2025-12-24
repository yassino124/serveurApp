// src/modules/wallet/dto/create-payment-intent.dto.ts
import { IsNumber, IsPositive, Max, Min, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentIntentDto {
  @ApiProperty({
    description: 'Montant à recharger',
    minimum: 1,
    maximum: 10000,
    example: 50
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  @Max(10000)
  amount: number;

  @ApiProperty({
    description: 'Devise (optionnel, par défaut: TND)',
    required: false,
    example: 'TND'
  })
  @IsOptional()
  @IsString()
  currency?: string;
}