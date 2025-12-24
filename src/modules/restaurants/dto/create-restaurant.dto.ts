import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

// DTO pour un plat (dish) lors de la création du restaurant
export class CreateDishDto {
  @ApiProperty({ example: 'Ratatouille', description: 'Nom du plat' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiPropertyOptional({ example: 'Plat provençal aux légumes', description: 'Description du plat' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 12.5, description: 'Prix du plat' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    example: 'dish1.jpg',
    description: 'Nom de la photo prédéfinie (ex: dish1.jpg) ou URL complète d\'une image externe'
  })
  @IsString()
  @IsOptional()
  image?: string;
}

export class CreateRestaurantDto {
  @ApiProperty({ description: 'Nom du restaurant' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Adresse du restaurant' })
  @IsString()
  address: string;

  @ApiProperty({ description: 'Description du restaurant', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'URL ou nom de la photo principale du restaurant' })
  @IsString()
  photo: string;

  @ApiPropertyOptional({
    description: 'Liste optionnelle de plats à ajouter lors de la création du restaurant',
    type: [CreateDishDto],
    example: [
      {
        name: 'Ratatouille',
        description: 'Plat provençal aux légumes',
        price: 12.5,
        image: 'dish1.jpg'
      },
      {
        name: 'Pizza Margherita',
        description: 'Pizza italienne classique',
        price: 15,
        image: 'dish2.jpg'
      }
    ]
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDishDto)
  menu?: CreateDishDto[];
}
