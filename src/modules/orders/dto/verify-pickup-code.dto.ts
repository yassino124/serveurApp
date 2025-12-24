// src/modules/orders/dto/verify-pickup-code.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class VerifyPickupCodeDto {
  @ApiProperty({
    description: 'Code de récupération à 6 chiffres',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Length(6, 6, { message: 'Le code doit contenir exactement 6 chiffres' })
  @Matches(/^[0-9]{6}$/, { message: 'Le code doit contenir uniquement des chiffres' })
  pickup_code: string;
}