// src/reels/dto/delete-reel.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import { DeleteReason } from '../reel.schema';

export class DeleteReelDto {
  @ApiProperty({
    enum: DeleteReason,
    example: DeleteReason.PRIVACY_CONCERNS,
    description: 'Raison de la suppression du reel',
    required: false,
  })
  @IsOptional()
  @IsEnum(DeleteReason)
  reason?: DeleteReason;

  @ApiProperty({
    description: 'Explication détaillée de la suppression',
    example: "Je préfère supprimer ce reel car il contient des informations personnelles",
    required: false,
  })
  @IsOptional()
  @IsString()
  explanation?: string;

  @ApiProperty({
    description: 'Confirmation de suppression',
    example: 'DELETE',
    required: true,
  })
  @IsNotEmpty({ message: 'La confirmation de suppression est requise' })
  @IsString()
  confirmation: string;
}