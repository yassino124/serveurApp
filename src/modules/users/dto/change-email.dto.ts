import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
} from 'class-validator';

export class ChangeEmailDto {
  @ApiProperty({
    example: 'nouveau@email.tn',
    description: 'Nouvelle adresse email',
  })
  @IsEmail({}, { message: 'Email invalide' })
  @IsNotEmpty()
  new_email: string;

  @ApiProperty({
    example: 'Motdepasse123',
    description: 'Mot de passe actuel pour confirmation',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}