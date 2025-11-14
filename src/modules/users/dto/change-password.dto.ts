import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  MinLength,
  Matches,
} from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'AncienMotdepasse123',
    description: 'Mot de passe actuel',
  })
  @IsString()
  @MinLength(6)
  current_password: string;

  @ApiProperty({
    example: 'NouveauMotdepasse456',
    description: 'Nouveau mot de passe (différent de l\'ancien)',
  })
  @IsString()
  @MinLength(6, { message: 'Le mot de passe doit contenir au moins 6 caractères' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'Le mot de passe doit contenir au moins une lettre et un chiffre',
  })
  new_password: string;
}