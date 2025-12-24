import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({
    description: 'ID du restaurant ou de l\'utilisateur destinataire',
    example: 'restaurant-id-123',
  })
  @IsNotEmpty({ message: 'Le destinataire est requis' })
  @IsString({ message: 'Le destinataire doit être une chaîne' })
  recipient_id: string;

  @ApiProperty({
    description: 'Contenu du message',
    example: 'Bonjour, avez-vous des plats végétariens disponibles ?',
  })
  @IsNotEmpty({ message: 'Le contenu du message est requis' })
  @IsString({ message: 'Le contenu doit être une chaîne' })
  content: string;

  @ApiProperty({
    description: 'Pièces jointes (URLs d\'images, fichiers)',
    type: [String],
    required: false,
    example: ['https://example.com/image.jpg'],
  })
  @IsOptional()
  @IsArray({ message: 'Les pièces jointes doivent être un tableau' })
  @IsString({ each: true, message: 'Chaque pièce jointe doit être une chaîne' })
  attachments?: string[];

  @ApiProperty({
    description: 'ID du message auquel on répond (optionnel)',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'L\'ID du message de réponse doit être une chaîne' })
  reply_to_message_id?: string;
}
