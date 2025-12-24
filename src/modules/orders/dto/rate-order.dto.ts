// src/modules/orders/dto/rate-order.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class RateOrderDto {
  @ApiProperty({
    description: 'Note de 1 à 5 étoiles',
    example: 5,
    minimum: 1,
    maximum: 5,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({
    description: 'Commentaire (optionnel)',
    example: 'Excellente cuisine, service rapide !',
    required: false,
  })
  @IsOptional()
  @IsString()
  review?: string;
}