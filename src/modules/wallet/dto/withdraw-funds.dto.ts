// src/modules/wallet/dto/withdraw-funds.dto.ts
import { IsNumber, IsPositive, Min, Max, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WithdrawFundsDto {
  @ApiProperty({
    description: 'Montant à retirer',
    minimum: 10,
    maximum: 5000,
    example: 100
  })
  @IsNumber()
  @IsPositive()
  @Min(10)
  @Max(5000)
  amount: number;

  @ApiProperty({
    description: 'Méthode de retrait',
    enum: ['bank_transfer', 'mobile_money'],
    example: 'bank_transfer'
  })
  @IsString()
  withdrawal_method: string;

  @ApiProperty({
    description: 'Informations de compte pour le retrait',
    example: 'IBAN: TN59 1000 1000 1000 1000 1000'
  })
  @IsString()
  account_details: string;
}