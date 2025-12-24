import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Message,
  MessageDocument,
  Conversation,
  ConversationDocument,
  ParticipantType,
  MessageStatus,
} from './message.schema';
import { SendMessageDto } from './dto/send-message.dto';
import { GetConversationDto } from './dto/get-conversation.dto';
import { User, UserDocument } from '../users/user.schema';
import { Restaurant, RestaurantDocument } from '../restaurants/restaurant.schema';

@Injectable()
export class MessagerieService {
  private readonly logger = new Logger(MessagerieService.name);

  constructor(
    @InjectModel(Message.name) public messageModel: Model<MessageDocument>,
    @InjectModel(Conversation.name)
    public conversationModel: Model<ConversationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Restaurant.name) private restaurantModel: Model<RestaurantDocument>,
  ) {}

  /**
   * Trouve ou crée une conversation entre deux participants
   */
  async findOrCreateConversation(
    user1_id: string,
    user1_type: ParticipantType,
    user2_id: string,
    user2_type: ParticipantType,
  ): Promise<ConversationDocument> {
    // Chercher une conversation existante (dans les deux sens)
    let conversation = await this.conversationModel.findOne({
      $or: [
        {
          participant1_id: user1_id,
          participant1_type: user1_type,
          participant2_id: user2_id,
          participant2_type: user2_type,
        },
        {
          participant1_id: user2_id,
          participant1_type: user2_type,
          participant2_id: user1_id,
          participant2_type: user1_type,
        },
      ],
    });

    if (!conversation) {
      // Créer une nouvelle conversation
      conversation = new this.conversationModel({
        participant1_id: user1_id,
        participant1_type: user1_type,
        participant2_id: user2_id,
        participant2_type: user2_type,
        last_read_at: new Map(),
      });
      await conversation.save();
      this.logger.log(
        `✅ Nouvelle conversation créée: ${conversation.conversation_id}`,
      );
    }

    return conversation;
  }

  /**
   * Détermine si un ID correspond à un restaurant ou un utilisateur
   * Si c'est un restaurant, retourne le ownerId (propriétaire du restaurant)
   */
  private async detectRecipientType(recipient_id: string): Promise<{
    type: ParticipantType;
    id: string;
    restaurant_id?: string; // ID du restaurant si c'est un restaurant
  }> {
    // 1. Vérifier si c'est un restaurant (par le champ 'id')
    const restaurant = await this.restaurantModel.findOne({ id: recipient_id }).exec();
    if (restaurant) {
      this.logger.log(`✅ Destinataire détecté comme RESTAURANT: ${recipient_id}`);
      // Trouver le propriétaire du restaurant
      let ownerUser;
      if (Types.ObjectId.isValid(restaurant.ownerId)) {
        ownerUser = await this.userModel.findById(restaurant.ownerId).exec();
      } else {
        ownerUser = await this.userModel.findOne({ user_id: restaurant.ownerId }).exec();
      }
      
      if (!ownerUser) {
        throw new NotFoundException(
          `Propriétaire du restaurant "${recipient_id}" non trouvé.`,
        );
      }
      
      this.logger.log(`✅ Message sera envoyé au propriétaire du restaurant: ${String(ownerUser._id)}`);
      return { 
        type: ParticipantType.USER, // Le message va au propriétaire (user)
        id: String(ownerUser._id),
        restaurant_id: recipient_id, // On garde l'ID du restaurant pour référence
      };
    }

    // 2. Vérifier si c'est un utilisateur (par ObjectId MongoDB)
    if (Types.ObjectId.isValid(recipient_id)) {
      const user = await this.userModel.findById(recipient_id).exec();
      if (user) {
        this.logger.log(`✅ Destinataire détecté comme USER (ObjectId): ${recipient_id}`);
        return { type: ParticipantType.USER, id: String(user._id) };
      }
    }

    // 3. Vérifier si c'est un utilisateur (par user_id UUID)
    const user = await this.userModel.findOne({ user_id: recipient_id }).exec();
    if (user) {
      this.logger.log(`✅ Destinataire détecté comme USER (user_id): ${recipient_id}`);
      return { type: ParticipantType.USER, id: String(user._id) };
    }

    throw new NotFoundException(
      `Destinataire non trouvé. L'ID "${recipient_id}" ne correspond ni à un restaurant ni à un utilisateur.`,
    );
  }

  /**
   * Envoie un message - détecte automatiquement si le destinataire est un restaurant ou un utilisateur
   */
  async sendMessage(
    sender_id: string,
    sender_type: ParticipantType,
    dto: SendMessageDto,
  ): Promise<MessageDocument> {
    this.logger.log(`🔍 Détection du destinataire: ${dto.recipient_id}`);
    
    // Détecter le type du destinataire
    const recipient = await this.detectRecipientType(dto.recipient_id);
    
    this.logger.log(`✅ Destinataire détecté: ${recipient.type} avec ID: ${recipient.id}`);

    // Normaliser le sender_id pour la comparaison
    let normalizedSenderId = sender_id;
    if (sender_type === ParticipantType.USER) {
      // Si c'est un utilisateur, essayer de trouver son ObjectId ou user_id
      if (Types.ObjectId.isValid(sender_id)) {
        const senderUser = await this.userModel.findById(sender_id).exec();
        if (senderUser) {
          normalizedSenderId = String(senderUser._id);
        }
      } else {
        // C'est peut-être un UUID user_id
        const senderUser = await this.userModel.findOne({ user_id: sender_id }).exec();
        if (senderUser) {
          normalizedSenderId = String(senderUser._id);
        }
      }
    }

    // Vérifier qu'on ne s'envoie pas un message à soi-même
    // Comparer les IDs normalisés
    if (normalizedSenderId === recipient.id || sender_id === dto.recipient_id) {
      throw new BadRequestException(
        'Vous ne pouvez pas vous envoyer un message à vous-même',
      );
    }

    // Normaliser le sender_id pour la conversation (utiliser l'ObjectId si c'est un user)
    const conversationSenderId = sender_type === ParticipantType.USER 
      ? normalizedSenderId 
      : sender_id;

    // Trouver ou créer la conversation
    const conversation = await this.findOrCreateConversation(
      conversationSenderId,
      sender_type,
      recipient.id,
      recipient.type,
    );

    // Vérifier si la conversation est bloquée
    if (conversation.is_blocked) {
      throw new ForbiddenException('Cette conversation est bloquée');
    }

    // Créer le message (utiliser l'ID normalisé pour les users)
    const message = new this.messageModel({
      conversation_id: conversation.conversation_id,
      sender_id: conversationSenderId,
      sender_type,
      content: dto.content,
      attachments: dto.attachments || [],
      reply_to_message_id: dto.reply_to_message_id,
      status: MessageStatus.SENT,
    });

    await message.save();

    // Mettre à jour la conversation avec le dernier message
    conversation.last_message_id = message.message_id;
    conversation.last_message_content = dto.content;
    conversation.last_message_at = new Date();
    await conversation.save();

    this.logger.log(
      `✅ Message envoyé (${sender_type} -> ${recipient.type}): ${message.message_id} dans la conversation ${conversation.conversation_id}`,
    );

    return message;
  }


  /**
   * Marque les messages comme lus
   */
  async markMessagesAsRead(
    conversation_id: string,
    user_id: string,
  ): Promise<void> {
    await this.messageModel.updateMany(
      {
        conversation_id,
        sender_id: { $ne: user_id }, // Pas les messages de l'utilisateur
        status: { $ne: MessageStatus.READ },
      },
      {
        status: MessageStatus.READ,
      },
    );

    // Mettre à jour la date de dernière lecture dans la conversation
    const conversation = await this.conversationModel.findOne({
      conversation_id,
    });
    if (conversation) {
      conversation.last_read_at.set(user_id, new Date());
      await conversation.save();
    }
  }

  /**
   * Supprime un message (soft delete)
   */
  async deleteMessage(message_id: string, user_id: string): Promise<void> {
    const message = await this.messageModel.findOne({ message_id });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier que l'utilisateur est l'expéditeur
    if (message.sender_id !== user_id) {
      throw new ForbiddenException(
        'Vous ne pouvez supprimer que vos propres messages',
      );
    }

    message.is_deleted = true;
    message.deleted_at = new Date();
    await message.save();

    this.logger.log(`🗑️ Message supprimé: ${message_id}`);
  }

  /**
   * Modifie un message
   */
  async editMessage(
    message_id: string,
    user_id: string,
    new_content: string,
  ): Promise<MessageDocument> {
    const message = await this.messageModel.findOne({ message_id });

    if (!message) {
      throw new NotFoundException('Message non trouvé');
    }

    // Vérifier que l'utilisateur est l'expéditeur
    if (message.sender_id !== user_id) {
      throw new ForbiddenException(
        'Vous ne pouvez modifier que vos propres messages',
      );
    }

    message.content = new_content;
    message.is_edited = true;
    message.edited_at = new Date();
    await message.save();

    this.logger.log(`✏️ Message modifié: ${message_id}`);
    return message;
  }

  /**
   * Archive une conversation
   */
  async archiveConversation(
    conversation_id: string,
    user_id: string,
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      conversation_id,
      $or: [{ participant1_id: user_id }, { participant2_id: user_id }],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    conversation.is_archived = true;
    conversation.archived_at = new Date();
    await conversation.save();

    this.logger.log(`📦 Conversation archivée: ${conversation_id}`);
  }

  /**
   * Bloque une conversation
   */
  async blockConversation(
    conversation_id: string,
    user_id: string,
  ): Promise<void> {
    const conversation = await this.conversationModel.findOne({
      conversation_id,
      $or: [{ participant1_id: user_id }, { participant2_id: user_id }],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation non trouvée');
    }

    conversation.is_blocked = true;
    conversation.blocked_by = user_id;
    await conversation.save();

    this.logger.log(`🚫 Conversation bloquée: ${conversation_id}`);
  }

  /**
   * Récupère tous les messages d'une conversation
   * @param current_user_id ID de l'utilisateur actuel (user ou restaurant owner)
   * @param participant_id ID du restaurant ou de l'utilisateur avec lequel on communique
   * @returns Tous les messages de la conversation
   */
  async conversation(
    current_user_id: string,
    participant_id: string,
  ): Promise<{
    conversation_id: string;
    messages: MessageDocument[];
  }> {
    this.logger.log(
      `🔍 Récupération de la conversation entre ${current_user_id} et ${participant_id}`,
    );

    // Normaliser l'ID de l'utilisateur actuel
    let normalizedCurrentUserId = current_user_id;
    if (Types.ObjectId.isValid(current_user_id)) {
      const currentUser = await this.userModel.findById(current_user_id).exec();
      if (currentUser) {
        normalizedCurrentUserId = String(currentUser._id);
      }
    } else {
      const currentUser = await this.userModel
        .findOne({ user_id: current_user_id })
        .exec();
      if (currentUser) {
        normalizedCurrentUserId = String(currentUser._id);
      }
    }

    // Détecter le type du participant (restaurant ou user)
    const participant = await this.detectRecipientType(participant_id);

    this.logger.log(
      `✅ Participant détecté: ${participant.type} avec ID: ${participant.id}`,
    );

    // Trouver la conversation entre les deux participants
    const conversation = await this.conversationModel.findOne({
      $or: [
        {
          participant1_id: normalizedCurrentUserId,
          participant1_type: ParticipantType.USER,
          participant2_id: participant.id,
          participant2_type: participant.type,
        },
        {
          participant1_id: participant.id,
          participant1_type: participant.type,
          participant2_id: normalizedCurrentUserId,
          participant2_type: ParticipantType.USER,
        },
      ],
    });

    if (!conversation) {
      throw new NotFoundException(
        'Aucune conversation trouvée avec ce participant',
      );
    }

    // Récupérer tous les messages de la conversation (non supprimés)
    const messages = await this.messageModel
      .find({
        conversation_id: conversation.conversation_id,
        is_deleted: false,
      })
      .sort({ created_at: 1 }) // Plus anciens en premier
      .exec();

    // Marquer les messages comme lus
    await this.markMessagesAsRead(
      conversation.conversation_id,
      normalizedCurrentUserId,
    );

    this.logger.log(
      `✅ Conversation trouvée avec ${messages.length} messages`,
    );

    return {
      conversation_id: conversation.conversation_id,
      messages,
    };
  }

  /**
   * Récupère la liste de toutes les conversations avec les informations de base sur chaque participant
   * @param current_user_id ID de l'utilisateur actuel (user ou restaurant owner)
   * @returns Liste des conversations avec qui il communique (sans détails des messages)
   */
  async getAllConversations(
    current_user_id: string,
  ): Promise<
    Array<{
      conversation_id: string;
      participant_id: string;
      participant_type: ParticipantType;
      participant_name: string;
      participant_username?: string;
      participant_image?: string;
      last_message_content?: string;
      last_message_at?: Date;
      unread_count: number;
    }>
  > {
    this.logger.log(
      `📋 Récupération de toutes les conversations pour ${current_user_id}`,
    );

    // Normaliser l'ID de l'utilisateur actuel
    let normalizedCurrentUserId = current_user_id;
    if (Types.ObjectId.isValid(current_user_id)) {
      const currentUser = await this.userModel.findById(current_user_id).exec();
      if (currentUser) {
        normalizedCurrentUserId = String(currentUser._id);
      }
    } else {
      const currentUser = await this.userModel
        .findOne({ user_id: current_user_id })
        .exec();
      if (currentUser) {
        normalizedCurrentUserId = String(currentUser._id);
      }
    }

    // Récupérer toutes les conversations de l'utilisateur
    const conversations = await this.conversationModel
      .find({
        $or: [
          { participant1_id: normalizedCurrentUserId },
          { participant2_id: normalizedCurrentUserId },
        ],
        is_archived: false,
        is_blocked: false,
      })
      .sort({ last_message_at: -1 })
      .exec();

    const conversationsList = await Promise.all(
      conversations.map(async (conversation) => {
        // Identifier l'autre participant
        const isParticipant1 =
          conversation.participant1_id === normalizedCurrentUserId;
        const otherParticipantId = isParticipant1
          ? conversation.participant2_id
          : conversation.participant1_id;
        const otherParticipantType = isParticipant1
          ? conversation.participant2_type
          : conversation.participant1_type;

        let participant_name = '';
        let participant_username: string | undefined;
        let participant_image: string | undefined;
        let participant_id = otherParticipantId;
        let finalParticipantType = otherParticipantType;

        // Récupérer les informations de l'autre participant
        if (otherParticipantType === ParticipantType.USER) {
          // C'est un utilisateur - mais il pourrait être propriétaire d'un restaurant
          let otherUser;
          if (Types.ObjectId.isValid(otherParticipantId)) {
            otherUser = await this.userModel.findById(otherParticipantId).exec();
          } else {
            otherUser = await this.userModel
              .findOne({ user_id: otherParticipantId })
              .exec();
          }

          if (otherUser) {
            // Vérifier si cet utilisateur est propriétaire d'un restaurant
            // (car les messages à un restaurant sont envoyés au propriétaire)
            // Utiliser user_id (UUID) si disponible, sinon _id (ObjectId)
            const userUserId = otherUser.user_id || String(otherUser._id);
            const restaurant = await this.restaurantModel
              .findOne({ ownerId: userUserId })
              .exec();

            if (restaurant) {
              // C'est en fait une conversation avec un restaurant
              // Retourner l'ID du restaurant pour pouvoir l'utiliser dans conversation()
              participant_name = restaurant.name;
              participant_image =
                restaurant.predefinedPhoto || restaurant.photos[0];
              participant_id = restaurant.id; // ID du restaurant à utiliser dans conversation()
              participant_username = otherUser.username;
              finalParticipantType = ParticipantType.RESTAURANT; // Ajuster le type pour la réponse
            } else {
              // C'est un utilisateur normal
              // Retourner user_id (UUID) si disponible, sinon _id (ObjectId)
              // Cet ID peut être utilisé directement dans conversation()
              participant_name = otherUser.full_name;
              participant_username = otherUser.username;
              participant_image = otherUser.profile_picture;
              participant_id = otherUser.user_id || String(otherUser._id); // ID utilisable dans conversation()
            }
          }
        } else if (otherParticipantType === ParticipantType.RESTAURANT) {
          // C'est un restaurant - mais en réalité, les messages vont au propriétaire
          // On doit trouver le restaurant et son propriétaire
          const restaurant = await this.restaurantModel
            .findOne({ id: otherParticipantId })
            .exec();

          if (restaurant) {
            participant_name = restaurant.name;
            participant_image =
              restaurant.predefinedPhoto || restaurant.photos[0];
            participant_id = restaurant.id;

            // Essayer de récupérer le username du propriétaire
            let ownerUser;
            if (Types.ObjectId.isValid(restaurant.ownerId)) {
              ownerUser = await this.userModel
                .findById(restaurant.ownerId)
                .exec();
            } else {
              ownerUser = await this.userModel
                .findOne({ user_id: restaurant.ownerId })
                .exec();
            }

            if (ownerUser) {
              participant_username = ownerUser.username;
            } else if (restaurant.ownerUsername) {
              participant_username = restaurant.ownerUsername;
            }
          }
        }

        // Compter les messages non lus
        const unreadCount = await this.messageModel.countDocuments({
          conversation_id: conversation.conversation_id,
          sender_id: { $ne: normalizedCurrentUserId },
          status: { $ne: MessageStatus.READ },
          is_deleted: false,
        });

        return {
          conversation_id: conversation.conversation_id,
          participant_id,
          participant_type: finalParticipantType,
          participant_name: participant_name || 'Inconnu',
          participant_username,
          participant_image,
          last_message_content: conversation.last_message_content,
          last_message_at: conversation.last_message_at,
          unread_count: unreadCount,
        };
      }),
    );

    this.logger.log(
      `✅ ${conversationsList.length} conversations trouvées pour l'utilisateur`,
    );

    return conversationsList;
  }
}

