// src/reels/dto/create-reel.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUrl,
  IsArray,
  IsEnum,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { CuisineCategory } from '../../users/user.schema';
import { ReelVisibility } from '../reel.schema';
import { Transform } from 'class-transformer';

export class CreateReelDto {
  @ApiProperty({
    description: 'URL de la vidéo du reel',
    example: 'https://example.com/videos/reel-123.mp4',
  })
  @IsUrl({}, { message: "L'URL de la vidéo doit être valide" })
  @IsNotEmpty({ message: "L'URL de la vidéo est requise" })
  video_url: string;

  @ApiProperty({
    description: "Légende du reel",
    example: "Découvrez ma recette secrète de couscous ! 🍲",
  })
  @IsString({ message: 'La légende doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'La légende est requise' })
  @MaxLength(500, { message: 'La légende ne peut pas dépasser 500 caractères' })
  caption: string;

  @ApiProperty({
    description: 'Hashtags pour le reel',
    example: ['couscous', 'recettetunisienne', 'food'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map(tag => tag.trim().replace('#', ''));
    }
    return value;
  })
  hashtags?: string[];

  @ApiProperty({
    description: 'Catégories culinaires',
    example: ['tunisian', 'mediterranean'],
    enum: CuisineCategory,
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(CuisineCategory, { each: true })
  categories?: CuisineCategory[];

  @ApiProperty({
    description: 'Localisation',
    example: 'Tunis, Tunisia',
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'URL de la miniature',
    example: 'https://example.com/thumbnails/reel-123.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: "L'URL de la miniature doit être valide" })
  thumbnail_url?: string;

  @ApiProperty({
    description: 'Durée de la vidéo en secondes',
    example: 30,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(3, { message: 'La durée minimale est de 3 secondes' })
  @Max(300, { message: 'La durée maximale est de 300 secondes' })
  video_duration?: number;

  @ApiProperty({
    enum: ReelVisibility,
    example: ReelVisibility.PUBLIC,
    description: 'Visibilité du reel',
    required: false,
  })
  @IsOptional()
  @IsEnum(ReelVisibility)
  visibility?: ReelVisibility;

  @ApiProperty({
    description: 'Utiliser les fonctionnalités AI pour la légende et hashtags',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  ai_enhanced?: boolean;
}