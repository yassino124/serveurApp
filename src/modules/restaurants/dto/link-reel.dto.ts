import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkReelToRestaurantDto {
  @ApiProperty({ description: 'ID du reel à lier' })
  @IsString()
  @IsNotEmpty()
  reelId: string;
}
