// src/modules/reels/dto/add-comment.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsMongoId } from 'class-validator';

export class AddCommentDto {
  @ApiProperty({ description: 'Texte du commentaire' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ description: 'ID du commentaire parent (pour les réponses)', required: false })
  @IsOptional()
  @IsString()
  parent_comment_id?: string;
}