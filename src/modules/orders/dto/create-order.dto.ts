// src/modules/orders/dto/create-order.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsEnum,
  IsOptional,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { PaymentMethod } from '../order.schema';

export class CreateOrderDto {
  @ApiProperty({
    description: 'ID du reel contenant le plat à commander',
    example: 'uuid-reel-123',
  })
  @IsString({ message: 'Le reel_id doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'Le reel_id est requis' })
  reel_id: string;

  @ApiProperty({
    description: 'Quantité à commander',
    example: 2,
    minimum: 1,
  })
  @IsInt({ message: 'La quantité doit être un nombre entier' })
  @Min(1, { message: 'La quantité doit être au moins 1' })
  quantity: number;

  @ApiProperty({
    description: 'Notes ou instructions spéciales',
    example: 'Sans piment s\'il vous plaît',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Les notes doivent être une chaîne de caractères' })
  @MaxLength(500, { message: 'Les notes ne doivent pas dépasser 500 caractères' })
  customer_notes?: string;

  @ApiProperty({
    description: 'Prix unitaire personnalisé (optionnel)',
    example: 15.5,
    required: false,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Le prix unitaire doit être un nombre' })
  @Min(0, { message: 'Le prix unitaire ne peut pas être négatif' })
  custom_unit_price?: number;

  // ✅ CORRIGÉ: Utiliser l'enum PaymentMethod
  @ApiProperty({ 
    description: 'Méthode de paiement',
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
    required: false
  })
  @IsEnum(PaymentMethod, { message: 'La méthode de paiement doit être cash, wallet ou card' })
  @IsOptional()
  payment_method?: PaymentMethod;
}