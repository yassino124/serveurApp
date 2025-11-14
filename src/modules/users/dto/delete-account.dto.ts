import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
} from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({
    example: 'Motdepasse123',
    description: 'Mot de passe pour confirmer la suppression définitive',
  })
  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est requis pour confirmer la suppression' })
  password: string;
}