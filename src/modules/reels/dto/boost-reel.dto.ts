// src/modules/reels/dto/boost-reel.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsArray, IsOptional, IsEnum, Min, Max } from 'class-validator';

export class BoostReelDto {
  @ApiProperty({
    description: 'ID du reel à booster',
    example: 'reel_12345',
    required: true
  })
  @IsString()
  reel_id: string;

  @ApiProperty({
    description: 'Montant du boosting en USD',
    example: 10,
    minimum: 5,
    maximum: 1000
  })
  @IsNumber()
  @Min(5)
  @Max(1000)
  amount: number;

  @ApiProperty({
    description: 'Durée du boosting en jours',
    example: 3,
    minimum: 1,
    maximum: 30,
    required: false
  })
  @IsNumber()
  @Min(1)
  @Max(30)
  @IsOptional()
  duration_days?: number = 3;

  @ApiProperty({
    description: 'Audience cible (catégories, hashtags)',
    example: ['tunisian', 'street_food', 'desserts'],
    required: false
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  target_audience?: string[] = [];

  @ApiProperty({
    description: 'ID du payment method Stripe (card_...)',
    example: 'pm_1PABCD...',
    required: false
  })
  @IsString()
  @IsOptional()
  payment_method_id?: string;
}

export class CancelBoostDto {
  @ApiProperty({
    description: 'ID du reel',
    example: 'reel_12345',
    required: true
  })
  @IsString()
  reel_id: string;

  @ApiProperty({
    description: 'Confirmation de l\'annulation',
    example: 'CANCEL',
    required: true
  })
  @IsString()
  confirmation: string;
}

export class BoostStatsDto {
  @ApiProperty({
    description: 'ID du reel',
    example: 'reel_12345',
    required: true
  })
  @IsString()
  reel_id: string;

  @ApiProperty({
    description: 'Date de début pour les statistiques',
    example: '2024-01-01',
    required: false
  })
  @IsString()
  @IsOptional()
  start_date?: string;

  @ApiProperty({
    description: 'Date de fin pour les statistiques',
    example: '2024-12-31',
    required: false
  })
  @IsString()
  @IsOptional()
  end_date?: string;
}