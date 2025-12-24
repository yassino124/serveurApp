import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class RestaurantChatbotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  peopleCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  budget?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  availability?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dietaryRestrictions?: string;
}


