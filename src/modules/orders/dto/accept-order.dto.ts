// src/modules/orders/dto/accept-order.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsString, MaxLength } from 'class-validator';

export class AcceptOrderDto {
  @ApiProperty({
    description: 'Temps de préparation estimé en minutes',
    example: 20,
    minimum: 5,
    maximum: 120,
    required: false
  })
  @IsOptional()
  @IsInt({ message: 'Le temps de préparation doit être un nombre entier' })
  @Min(5, { message: 'Le temps de préparation doit être au moins 5 minutes' })
  @Max(120, { message: 'Le temps de préparation ne peut pas dépasser 120 minutes' })
  estimated_preparation_time?: number;

  @ApiProperty({
    description: 'Notes d\'acceptation ou instructions spéciales',
    example: 'Commande en cours de préparation',
    required: false
  })
  @IsOptional()
  @IsString({ message: 'Les notes doivent être une chaîne de caractères' })
  @MaxLength(200, { message: 'Les notes ne doivent pas dépasser 200 caractères' })
  acceptance_notes?: string;
}