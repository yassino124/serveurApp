import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @ApiProperty({
    description: 'Raison de l\'annulation',
    example: 'J\'ai changé d\'avis',
  })
  @IsString({ message: 'La raison doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'La raison d\'annulation est requise' })
  @MaxLength(500, { message: 'La raison ne doit pas dépasser 500 caractères' })
  reason: string;
}