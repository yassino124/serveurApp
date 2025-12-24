import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddReviewDto {
  @ApiProperty({ description: 'Note du restaurant (1-5)' })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: 'Commentaire de l’utilisateur' })
  @IsString()
  @IsNotEmpty()
  comment: string;
}
