import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagerieService } from './messagerie.service';
import { ParticipantType, MessageStatus } from './message.schema';

// Interface pour les données JWT
interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

// Interface pour les utilisateurs connectés
interface ConnectedUser {
  user_id: string;
  socket_id: string;
  user_type: ParticipantType;
}

@WebSocketGateway({
  cors: {
    origin: '*', // À configurer selon vos besoins
    credentials: true,
  },
  namespace: '/messagerie',
})
export class MessagerieGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagerieGateway.name);
  private connectedUsers: Map<string, ConnectedUser> = new Map(); // Map<socket_id, user_info>
  private userSockets: Map<string, string[]> = new Map(); // Map<user_id, [socket_ids]>

  constructor(
    private readonly messagerieService: MessagerieService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Gère la connexion d'un client WebSocket
   */
  async handleConnection(client: Socket) {
    try {
      // Récupérer le token depuis le handshake
      const token = this.extractTokenFromSocket(client);
      
      if (!token) {
        this.logger.warn(`❌ Connexion refusée: pas de token pour ${client.id}`);
        client.disconnect();
        return;
      }

      // Vérifier et décoder le token JWT
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      }) as JwtPayload;

      const user_id = payload.sub;
      const user_type = ParticipantType.USER; // Par défaut, les utilisateurs connectés sont des users

      // Stocker la connexion
      this.connectedUsers.set(client.id, {
        user_id,
        socket_id: client.id,
        user_type,
      });

      // Ajouter le socket à la liste des sockets de l'utilisateur
      if (!this.userSockets.has(user_id)) {
        this.userSockets.set(user_id, []);
      }
      this.userSockets.get(user_id)!.push(client.id);

      // Rejoindre la room de l'utilisateur pour recevoir ses messages
      client.join(`user:${user_id}`);

      this.logger.log(
        `✅ Utilisateur connecté: ${user_id} (socket: ${client.id})`,
      );

      // Notifier les autres que l'utilisateur est en ligne
      client.broadcast.emit('user:online', { user_id });
    } catch (error) {
      this.logger.error(`❌ Erreur lors de la connexion: ${error.message}`);
      client.disconnect();
    }
  }

  /**
   * Gère la déconnexion d'un client WebSocket
   */
  async handleDisconnect(client: Socket) {
    const userInfo = this.connectedUsers.get(client.id);
    
    if (userInfo) {
      const { user_id } = userInfo;

      // Retirer le socket de la liste
      const sockets = this.userSockets.get(user_id);
      if (sockets) {
        const index = sockets.indexOf(client.id);
        if (index > -1) {
          sockets.splice(index, 1);
        }
        // Si plus de sockets, retirer l'utilisateur
        if (sockets.length === 0) {
          this.userSockets.delete(user_id);
        }
      }

      this.connectedUsers.delete(client.id);

      this.logger.log(
        `👋 Utilisateur déconnecté: ${user_id} (socket: ${client.id})`,
      );

      // Notifier les autres que l'utilisateur est hors ligne
      client.broadcast.emit('user:offline', { user_id });
    }
  }

  /**
   * Écoute les nouveaux messages envoyés via WebSocket
   */
  @SubscribeMessage('message:send')
  async handleSendMessage(
    @MessageBody() data: {
      recipient_id: string;
      content: string;
      attachments?: string[];
      reply_to_message_id?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userInfo = this.connectedUsers.get(client.id);
      
      if (!userInfo) {
        client.emit('error', { message: 'Utilisateur non authentifié' });
        return;
      }

      const { user_id } = userInfo;

      // Envoyer le message - le service détecte automatiquement le type du destinataire
      const message = await this.messagerieService.sendMessage(
        user_id,
        ParticipantType.USER,
        {
          recipient_id: data.recipient_id,
          content: data.content,
          attachments: data.attachments,
          reply_to_message_id: data.reply_to_message_id,
        },
      );

      // Récupérer la conversation pour obtenir l'ID
      const conversation = await this.messagerieService.conversationModel.findOne({
        conversation_id: message.conversation_id,
      });

      // Envoyer le message au destinataire s'il est connecté
      const recipientSockets = this.userSockets.get(data.recipient_id) || [];
      recipientSockets.forEach((socketId) => {
        this.server.to(socketId).emit('message:new', {
          message,
          conversation_id: message.conversation_id,
        });
      });

      // Confirmer l'envoi à l'expéditeur
      client.emit('message:sent', {
        message_id: message.message_id,
        status: 'sent',
      });

      // Mettre à jour la liste des conversations pour les deux participants
      this.server.to(`user:${user_id}`).emit('conversation:updated', {
        conversation_id: message.conversation_id,
      });
      
      recipientSockets.forEach((socketId) => {
        this.server.to(socketId).emit('conversation:updated', {
          conversation_id: message.conversation_id,
        });
      });

      this.logger.log(
        `📨 Message envoyé via WebSocket: ${message.message_id}`,
      );
    } catch (error) {
      this.logger.error(`❌ Erreur lors de l'envoi du message: ${error.message}`);
      client.emit('error', { message: error.message });
    }
  }

  /**
   * Marquer les messages comme lus en temps réel
   */
  @SubscribeMessage('message:read')
  async handleMarkAsRead(
    @MessageBody() data: { conversation_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userInfo = this.connectedUsers.get(client.id);
      
      if (!userInfo) {
        return;
      }

      const { user_id } = userInfo;

      await this.messagerieService.markMessagesAsRead(
        data.conversation_id,
        user_id,
      );

      // Notifier l'autre participant que les messages ont été lus
      const conversation = await this.messagerieService.conversationModel.findOne({
        conversation_id: data.conversation_id,
      });

      if (conversation) {
        const otherParticipantId =
          conversation.participant1_id === user_id
            ? conversation.participant2_id
            : conversation.participant1_id;

        const otherSockets = this.userSockets.get(otherParticipantId) || [];
        otherSockets.forEach((socketId) => {
          this.server.to(socketId).emit('message:read', {
            conversation_id: data.conversation_id,
            read_by: user_id,
          });
        });
      }

      this.logger.log(
        `✅ Messages marqués comme lus: ${data.conversation_id} par ${user_id}`,
      );
    } catch (error) {
      this.logger.error(`❌ Erreur lors du marquage comme lu: ${error.message}`);
    }
  }

  /**
   * Typing indicator - indique qu'un utilisateur est en train d'écrire
   */
  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @MessageBody() data: { conversation_id: string; recipient_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userInfo = this.connectedUsers.get(client.id);
    if (!userInfo) return;

    const recipientSockets = this.userSockets.get(data.recipient_id) || [];
    recipientSockets.forEach((socketId) => {
      this.server.to(socketId).emit('typing:start', {
        conversation_id: data.conversation_id,
        user_id: userInfo.user_id,
      });
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @MessageBody() data: { conversation_id: string; recipient_id: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userInfo = this.connectedUsers.get(client.id);
    if (!userInfo) return;

    const recipientSockets = this.userSockets.get(data.recipient_id) || [];
    recipientSockets.forEach((socketId) => {
      this.server.to(socketId).emit('typing:stop', {
        conversation_id: data.conversation_id,
        user_id: userInfo.user_id,
      });
    });
  }

  /**
   * Extrait le token JWT depuis le socket
   */
  private extractTokenFromSocket(client: Socket): string | null {
    // Essayer depuis les query params
    const token = client.handshake.query.token as string;
    if (token) return token;

    // Essayer depuis les headers
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }
}

