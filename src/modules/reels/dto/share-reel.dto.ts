// src/modules/reels/dto/share-reel.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class ShareReelDto {
  @ApiProperty({ 
    description: 'Plateforme de partage',
    enum: ['whatsapp', 'instagram', 'facebook', 'twitter', 'copy_link', 'other']
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['whatsapp', 'instagram', 'facebook', 'twitter', 'copy_link', 'other'])
  platform: string;
}