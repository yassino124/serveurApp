import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, IsNumber, Min } from 'class-validator';
import { OrderStatus } from '../order.schema';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.PREPARING,
    description: 'Nouveau statut de la commande',
  })
  @IsEnum(OrderStatus, { message: 'Statut de commande invalide' })
  status: OrderStatus;

  @ApiProperty({
    description: 'Raison de l\'annulation (si status = cancelled)',
    example: 'Ingrédients non disponibles',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'La raison doit être une chaîne de caractères' })
  @MaxLength(500, { message: 'La raison ne doit pas dépasser 500 caractères' })
  cancellation_reason?: string;

  @ApiProperty({
    description: 'Temps de préparation estimé en minutes',
    example: 30,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Le temps de préparation doit être d\'au moins 1 minute' })
  estimated_preparation_time?: number;

  @ApiProperty({
    description: 'Instructions pour récupérer la commande',
    example: 'Veuillez récupérer au comptoir principal',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Les instructions ne doivent pas dépasser 200 caractères' })
  pickup_instructions?: string;
}