// src/modules/reels/dto/create-reel-ai.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { 
  IsString, 
  IsOptional, 
  IsIn, 
  MinLength, 
  MaxLength,
  IsNumber,
  Min,
  Max
} from 'class-validator';

export class CreateReelAIDto {
  @ApiProperty({
    example: 'Couscous',
    description: 'Nom du plat à générer',
    required: true,
  })
  @IsString()
  @MinLength(2, { message: 'Le nom du plat doit contenir au moins 2 caractères' })
  @MaxLength(100, { message: 'Le nom du plat ne peut pas dépasser 100 caractères' })
  dishName: string;

  @ApiProperty({
    example: 'tunisian',
    description: 'Style de cuisine',
    required: false,
  })
  @IsOptional()
  @IsString()
  cuisine?: string;

  @ApiProperty({
    example: 'cinematic',
    description: 'Style visuel',
    enum: ['cinematic', 'minimalist', 'rustic', 'modern', 'traditional'],
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['cinematic', 'minimalist', 'rustic', 'modern', 'traditional'])
  style?: string;

  @ApiProperty({
    example: 'Un plat traditionnel tunisien avec viande et légumes',
    description: 'Description détaillée',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'La description ne peut pas dépasser 500 caractères' })
  description?: string;

  @ApiProperty({
    example: 'public',
    description: 'Visibilité du reel',
    enum: ['public', 'private', 'followers'],
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['public', 'private', 'followers'])
  visibility?: string;

  @ApiProperty({
    example: 'Tunis, Tunisia',
    description: 'Localisation',
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    example: 6,
    description: 'Durée de la vidéo en secondes',
    required: false,
    minimum: 3,
    maximum: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(3, { message: 'La durée minimum est de 3 secondes' })
  @Max(10, { message: 'La durée maximum est de 10 secondes' })
  duration?: number;
}