import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetConversationByParticipantDto {
  @ApiProperty({
    description: 'ID du restaurant ou de l\'utilisateur avec lequel vous communiquez',
    example: 'restaurant-id-123 ou user-id-456',
  })
  @IsNotEmpty({ message: 'L\'ID du participant est requis' })
  @IsString({ message: 'L\'ID du participant doit être une chaîne' })
  participant_id: string;
}

