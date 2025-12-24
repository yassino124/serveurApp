// src/reels/dto/update-reel.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsEnum,
  IsOptional,
  IsBoolean,
  MaxLength,
  IsUrl,
} from 'class-validator';
import { CuisineCategory } from '../../users/user.schema';
import { ReelVisibility } from '../reel.schema';
import { Transform } from 'class-transformer';

export class UpdateReelDto {
  @ApiProperty({
    description: "Légende du reel",
    example: "Nouvelle version de ma recette de couscous ! 🍲",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @ApiProperty({
    description: 'Hashtags pour le reel',
    example: ['couscous', 'recette', 'tunisie'],
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
    example: 'Sousse, Tunisia',
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'URL de la miniature',
    example: 'https://example.com/thumbnails/new-thumbnail-1234567890.jpg',
    required: false,
  })
  @IsOptional()
  @IsUrl({}, { message: "L'URL de la miniature doit être valide" })
  thumbnail_url?: string;

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
    description: 'Piste musicale',
    example: 'Summer Vibes',
    required: false,
  })
  @IsOptional()
  @IsString()
  music_track?: string;

  @ApiProperty({
    description: 'Artiste musical',
    example: 'DJ Food',
    required: false,
  })
  @IsOptional()
  @IsString()
  music_artist?: string;

  @ApiProperty({
    description: 'Utiliser les fonctionnalités AI pour la légende et hashtags',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  ai_enhanced?: boolean;
}