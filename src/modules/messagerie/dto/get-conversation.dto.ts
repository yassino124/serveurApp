import { IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetConversationDto {
  @ApiProperty({
    description: 'Numéro de page pour la pagination',
    required: false,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt({ message: 'Le numéro de page doit être un entier' })
  @Min(1, { message: 'Le numéro de page doit être >= 1' })
  page?: number = 1;

  @ApiProperty({
    description: 'Nombre de messages par page',
    required: false,
    default: 20,
    minimum: 1,
  })
  @IsOptional()
  @IsInt({ message: 'La limite doit être un entier' })
  @Min(1, { message: 'La limite doit être >= 1' })
  limit?: number = 20;
}

