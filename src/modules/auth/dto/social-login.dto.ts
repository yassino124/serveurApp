import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsEmail, IsString } from 'class-validator';

export enum SocialProvider {
  GOOGLE = 'google',
  APPLE = 'apple'
}

export class SocialLoginDto {
  @ApiProperty({
    enum: SocialProvider,
    example: SocialProvider.GOOGLE,
    description: 'Provider d\'authentification sociale'
  })
  @IsEnum(SocialProvider)
  @IsNotEmpty()
  provider: SocialProvider;

  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6I...',
    description: 'Token d\'authentification du provider'
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'user@gmail.com',
    description: 'Email de l\'utilisateur (optionnel pour Apple)',
    required: false
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'John Doe',
    description: 'Nom complet (optionnel)',
    required: false
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export class SocialRegisterDto {
  @ApiProperty()
  @IsEnum(SocialProvider)
  @IsNotEmpty()
  provider: SocialProvider;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  provider_id: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  username?: string;
}