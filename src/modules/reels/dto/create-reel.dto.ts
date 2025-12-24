// src/modules/reels/dto/create-reel.dto.ts
import { 
  IsString, 
  IsNotEmpty, 
  IsArray, 
  IsOptional, 
  IsBoolean, 
  IsInt, 
  Min, 
  IsUrl,
  ArrayMinSize,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReelDto {
  @ApiProperty({
    description: 'URL de la vidéo',
    example: 'https://example.com/videos/reel.mp4',
  })
  @IsString({ message: 'L\'URL de la vidéo doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'L\'URL de la vidéo est requise' })
  // ✅ CORRECTION: Validation flexible qui accepte aussi localhost
  @Matches(
    /^(https?:\/\/)|(http:\/\/localhost)/,
    { message: 'L\'URL de la vidéo doit être valide (http ou https)' }
  )
  video_url: string;

  @ApiProperty({
    description: 'URL de la miniature (thumbnail)',
    example: 'https://example.com/thumbnails/thumb.jpg',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'L\'URL de la miniature doit être une chaîne de caractères' })
  // ✅ CORRECTION: Validation flexible, optionnelle
  @Matches(
    /^(https?:\/\/)|(http:\/\/localhost)|^$/,
    { message: 'L\'URL de la miniature doit être valide' }
  )
  thumbnail_url?: string;

  @ApiProperty({
    description: 'Légende du reel',
    example: 'Mon délicieux plat de pâtes 🍝',
  })
  @IsString({ message: 'La légende doit être une chaîne de caractères' })
  @IsNotEmpty({ message: 'La légende est requise' })
  @MinLength(1, { message: 'La légende doit contenir au moins 1 caractère' })
  @MaxLength(2200, { message: 'La légende ne peut pas dépasser 2200 caractères' })
  caption: string;

  @ApiProperty({
    description: 'Liste des hashtags',
    example: ['food', 'cooking', 'pasta'],
    type: [String],
  })
  @IsArray({ message: 'Les hashtags doivent être un tableau' })
  @IsString({ each: true, message: 'Chaque hashtag doit être une chaîne de caractères' })
  @IsOptional()
  hashtags?: string[];

  @ApiProperty({
    description: 'Catégories du reel',
    example: ['tunisian', 'seafood'],
    type: [String],
  })
  @IsArray({ message: 'Les catégories doivent être un tableau' })
  @ArrayMinSize(1, { message: 'Au moins une catégorie est requise' })
  @IsString({ each: true, message: 'Chaque catégorie doit être une chaîne de caractères' })
  categories: string[];

  @ApiProperty({
    description: 'Localisation',
    example: 'Tunis, Tunisia',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'La localisation doit être une chaîne de caractères' })
  @MaxLength(100, { message: 'La localisation ne peut pas dépasser 100 caractères' })
  location?: string;

  @ApiProperty({
    description: 'Durée de la vidéo en secondes',
    example: 15,
  })
  @IsOptional()
  @IsInt({ message: 'La durée doit être un nombre entier' })
  @Min(1, { message: 'La durée doit être d\'au moins 1 seconde' })
  video_duration?: number;

  @ApiProperty({
    description: 'Visibilité du reel',
    example: 'public',
    enum: ['public', 'private', 'friends'],
  })
  @IsOptional()
  @IsString({ message: 'La visibilité doit être une chaîne de caractères' })
  @Matches(/^(public|private|friends)$/, { 
    message: 'La visibilité doit être "public", "private" ou "friends"' 
  })
  visibility?: string;

  @ApiProperty({
    description: 'Si le reel a été amélioré par l\'IA',
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'ai_enhanced doit être un booléen' })
  ai_enhanced?: boolean;

  @ApiProperty({
    description: 'Légende générée par l\'IA',
    example: 'Délicieuses pâtes italiennes avec sauce tomate maison',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'La légende IA doit être une chaîne de caractères' })
  @MaxLength(2200, { message: 'La légende IA ne peut pas dépasser 2200 caractères' })
  ai_caption?: string;

  @ApiProperty({
    description: 'Hashtags générés par l\'IA',
    example: ['ItalianFood', 'PastaLover', 'Homemade'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Les hashtags IA doivent être un tableau' })
  @IsString({ each: true, message: 'Chaque hashtag IA doit être une chaîne de caractères' })
  ai_hashtags?: string[];

  @ApiProperty({
    description: 'Piste musicale',
    example: 'upbeat-cooking',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'La piste musicale doit être une chaîne de caractères' })
  @MaxLength(100, { message: 'Le nom de la piste ne peut pas dépasser 100 caractères' })
  music_track?: string;

  @ApiProperty({
    description: 'Artiste de la musique',
    example: 'John Doe',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'L\'artiste doit être une chaîne de caractères' })
  @MaxLength(100, { message: 'Le nom de l\'artiste ne peut pas dépasser 100 caractères' })
  music_artist?: string;
}