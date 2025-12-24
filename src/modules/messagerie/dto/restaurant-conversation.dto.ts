import { IsOptional, IsString, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RestaurantConversationDto {
  @ApiProperty({
    description: 'Contenu du message à envoyer (optionnel - si non fourni, retourne juste la conversation)',
    example: 'Bonjour, avez-vous des plats végétariens disponibles ?',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Le contenu du message doit être une chaîne' })
  message?: string;

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

