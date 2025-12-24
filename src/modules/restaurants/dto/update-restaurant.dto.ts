import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRestaurantDto {
  @ApiPropertyOptional({ description: 'Nom du restaurant' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Adresse du restaurant' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ description: 'Description du restaurant' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Photo principale du restaurant' })
  @IsString()
  @IsOptional()
  photo?: string;
}
