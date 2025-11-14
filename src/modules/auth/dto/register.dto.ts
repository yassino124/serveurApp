import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsNotEmpty,
  IsArray,
} from 'class-validator';
import { UserRole, CuisineCategory } from '../../users/user.schema';
import { Transform } from 'class-transformer';


export class RegisterDto {
  @ApiProperty({
    example: 'chef123',
    description: "Nom d'utilisateur unique (3-20 caractères)",
  })
  @IsString({ message: "Le nom d'utilisateur doit être une chaîne" })
  @IsNotEmpty({ message: "Le nom d'utilisateur est requis" })
  @MinLength(3, { message: "Le nom d'utilisateur doit avoir au moins 3 caractères" })
  @MaxLength(20, { message: "Le nom d'utilisateur ne doit pas dépasser 20 caractères" })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: "Le nom d'utilisateur ne peut contenir que des lettres, chiffres et underscores",
  })
  username: string;

  @ApiProperty({
    example: 'chef@food.tn',
    description: 'Adresse email valide',
  })
  @IsEmail({}, { message: "L'adresse email est invalide" })
  @IsNotEmpty({ message: "L'email est requis" })
  email: string;

  @ApiProperty({
    example: 'Motdepasse123',
    description: 'Mot de passe (min 6 caractères, avec lettre et chiffre)',
  })
  @IsString({ message: 'Le mot de passe doit être une chaîne' })
  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'Le mot de passe doit contenir au moins une lettre et un chiffre',
  })
  password: string;

  @ApiProperty({ example: 'Chef Ali', description: 'Nom complet' })
  @IsString({ message: 'Le nom complet doit être une chaîne' })
  @IsNotEmpty({ message: 'Le nom complet est requis' })
  @MaxLength(100, { message: 'Le nom complet ne doit pas dépasser 100 caractères' })
  full_name: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.CHEF,
    description: 'Type de compte',
  })
  @IsEnum(UserRole, { message: 'Type de compte invalide' })
  role: UserRole;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description: 'Photo de profil (JPG, PNG, GIF, max 5MB)',
  })
  @IsOptional()
  profile_picture?: string;


  // ✅ NOUVEAU : Catégories préférées lors de l'inscription
  @ApiProperty({
    enum: CuisineCategory,
    isArray: true,
    example: ['tunisian', 'seafood', 'desserts', 'healthy'],
    description: 'Catégories de cuisine préférées (optionnel) - Types de plats que l\'utilisateur aime',
    required: false,
    type: [String], // Pour Swagger
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