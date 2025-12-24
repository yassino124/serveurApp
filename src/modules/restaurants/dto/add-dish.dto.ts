import { IsString, IsOptional, IsNumber, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddDishDto {
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
