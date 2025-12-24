// src/modules/wallet/dto/transfer-funds.dto.ts
import { IsNumber, IsPositive, Min, Max, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferFundsDto {
  @ApiProperty({
    description: 'ID de l\'utilisateur destinataire',
    example: 'user123'
  })
  @IsString()
  to_user_id: string;

  @ApiProperty({
    description: 'Montant à transférer',
    minimum: 1,
    maximum: 5000,
    example: 50
  })
  @IsNumber()
  @IsPositive()
  @Min(1)
  @Max(5000)
  amount: number;

  @ApiProperty({
    description: 'Note ou description du transfert',
    required: false,
    example: 'Remboursement repas'
  })
  @IsOptional()
  @IsString()
  description?: string;
}