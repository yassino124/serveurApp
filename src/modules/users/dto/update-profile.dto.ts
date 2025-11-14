import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsArray,
  IsEnum,
} from 'class-validator';
import { CuisineCategory } from '../user.schema';
import { Transform } from 'class-transformer';


export class UpdateProfileDto {
  @ApiProperty({
    example: 'chef123',
    description: "Nouveau nom d'utilisateur",
    required: false,
  })
  @IsOptional()
  @IsString({ message: "Le nom d'utilisateur doit être une chaîne" })
  @MinLength(3, { message: "Le nom d'utilisateur doit avoir au moins 3 caractères" })
  @MaxLength(20, { message: "Le nom d'utilisateur ne doit pas dépasser 20 caractères" })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: "Le nom d'utilisateur ne peut contenir que des lettres, chiffres et underscores",
  })
  username?: string;

  @ApiProperty({
    example: 'Chef Ali Ben Said',
    description: 'Nouveau nom complet',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  full_name?: string;

  @ApiProperty({
    example: 'Passionné de cuisine tunisienne traditionnelle',
    description: 'Biographie',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description: 'Nouvelle photo de profil',
  })
  @IsOptional()
  profile_picture?: string;

  @ApiProperty({
    enum: CuisineCategory,
    isArray: true,
    example: ['seafood', 'italian', 'lifestyle'],
    description: 'Catégories de cuisine préférées',
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(CuisineCategory, { each: true })
  @Transform(({ value }) => {
    // ✅ Convertir string séparée par virgules en array
    if (typeof value === 'string') {
      return value.split(',').map(cat => cat.trim());
    }
    return value;
  })
  preferred_categories?: CuisineCategory[];
}