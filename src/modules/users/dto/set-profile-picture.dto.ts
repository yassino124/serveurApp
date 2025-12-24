import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, Matches, ValidateIf } from 'class-validator';

export enum DefaultProfilePicture {
  P2 = 'p2',
  P3 = 'p3',
  P4 = 'p4',
  P5 = 'p5',
}

export class SetProfilePictureDto {
  @ApiProperty({
    enum: DefaultProfilePicture,
    example: 'p2',
    description: 'Nom de l\'image par défaut (p2, p3, p4, p5)',
    required: false,
  })
  @IsOptional()
  @IsEnum(DefaultProfilePicture, {
    message: 'L\'image par défaut doit être p2, p3, p4 ou p5',
  })
  default_image?: DefaultProfilePicture;

  @ApiProperty({
    example: 'https://example.com/photo.jpg',
    description: 'URL externe de la photo de profil',
    required: false,
  })
  @ValidateIf((o) => !o.default_image)
  @IsString({ message: 'L\'URL doit être une chaîne de caractères' })
  @Matches(/^https?:\/\/.+/, {
    message: 'L\'URL doit commencer par http:// ou https://',
  })
  external_url?: string;
}

