// src/reels/dto/update-reel.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  IsBoolean,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { CuisineCategory } from '../../users/user.schema';
import { ReelVisibility } from '../reel.schema';
import { Transform } from 'class-transformer';

export class UpdateReelDto {
  @ApiProperty({
    description: 'Nouvelle légende du reel',
    example: "Nouvelle version améliorée de ma recette ! 🎉",
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'La légende doit être une chaîne de caractères' })
  @MaxLength(500, { message: 'La légende ne peut pas dépasser 500 caractères' })
  caption?: string;

  @ApiProperty({
    description: 'Nouveaux hashtags pour le reel',
    example: ['nouvelle_recette', 'amélioration', 'food'],
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
    description: 'Nouvelles catégories culinaires',
    example: ['tunisian', 'healthy'],
    enum: CuisineCategory,
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(CuisineCategory, { each: true })
  categories?: CuisineCategory[];

  @ApiProperty({
    description: 'Nouvelle localisation',
    example: 'Sousse, Tunisia',
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'Nouvelle URL de la miniature',
    example: 'https://example.com/thumbnails/updated-reel-123.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: "L'URL de la miniature doit être valide" })
  thumbnail_url?: string;

  @ApiProperty({
    enum: ReelVisibility,
    example: ReelVisibility.FOLLOWERS_ONLY,
    description: 'Nouvelle visibilité du reel',
    required: false,
  })
  @IsOptional()
  @IsEnum(ReelVisibility)
  visibility?: ReelVisibility;

  @ApiProperty({
    description: 'Réappliquer les fonctionnalités AI',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  ai_enhanced?: boolean;

  @ApiProperty({
    description: 'Musique/artiste du reel',
    example: 'Summer Vibes',
    required: false,
  })
  @IsOptional()
  @IsString()
  music_track?: string;

  @ApiProperty({
    description: 'Artiste de la musique',
    example: 'DJ Foodie',
    required: false,
  })
  @IsOptional()
  @IsString()
  music_artist?: string;
}