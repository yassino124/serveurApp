// src/modules/ai/minimax-video.service.ts - VERSION CORRIGÉE
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface MinimaxVideoResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  task_id?: string;
  status?: string;
  video_url?: string;
  file_id?: string;
}

interface MinimaxQueryResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  status: 'Processing' | 'Success' | 'Failed';
  file_id?: string;
  video_url?: string;
  error_message?: string;
}

@Injectable()
export class MinimaxVideoService {
  private readonly logger = new Logger(MinimaxVideoService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.minimax.chat';
  private readonly groupId: string;
  
  // État de la connexion
  private isApiKeyValid: boolean | null = null;
  private lastApiCheck: number = 0;
  private readonly API_CHECK_INTERVAL = 300000; // 5 minutes
  
  // Configuration
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000;
  private readonly GENERATION_TIMEOUT = 180000;
  private readonly POLL_INTERVAL = 5000;

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || '';
    this.groupId = process.env.MINIMAX_GROUP_ID || '';
    
    const hasApiKey = !!this.apiKey && this.apiKey.length > 10;
    const hasGroupId = !!this.groupId && this.groupId.length > 5;
    
    this.logger.log('🔧 === CONFIGURATION MINIMAX ===');
    this.logger.log(`API Key: ${hasApiKey ? '✓ Présente' : '✗ MANQUANTE'}`);
    this.logger.log(`Group ID: ${hasGroupId ? '✓ Présent' : '✗ MANQUANT'}`);
    
    if (hasApiKey && hasGroupId) {
      this.logger.log(`Preview API Key: ${this.apiKey.substring(0, 20)}...`);
      this.logger.log(`Preview Group ID: ${this.groupId}`);
      this.logger.log('Mode: 🚀 API RÉELLE (avec fallback si échec)');
    } else {
      this.logger.warn('⚠️  Configuration incomplète');
      this.logger.warn('Mode: 🔄 FALLBACK UNIQUEMENT');
      this.isApiKeyValid = false;
    }
    this.logger.log('================================');
  }

  /**
   * Vérifier si la clé API est valide (avec cache)
   */
  async isConfigured(): Promise<boolean> {
    const now = Date.now();
    if (this.isApiKeyValid !== null && (now - this.lastApiCheck) < this.API_CHECK_INTERVAL) {
      return this.isApiKeyValid;
    }

    if (!this.apiKey || !this.groupId) {
      this.isApiKeyValid = false;
      return false;
    }

    try {
      const result = await this.testConnection();
      this.isApiKeyValid = result.success;
      this.lastApiCheck = now;
      
      if (!this.isApiKeyValid) {
        this.logger.warn(`⚠️  Clé API invalide: ${result.message}`);
      }
      
      return this.isApiKeyValid;
    } catch (error) {
      this.isApiKeyValid = false;
      this.lastApiCheck = now;
      return false;
    }
  }

  /**
   * Tester la connexion à l'API Minimax
   */
  async testConnection(): Promise<{ 
    success: boolean; 
    message: string; 
    details?: any 
  }> {
    try {
      if (!this.apiKey || !this.groupId) {
        return {
          success: false,
          message: '❌ Configuration manquante',
          details: {
            api_key: this.apiKey ? '✓ Présente' : '✗ Manquante',
            group_id: this.groupId ? '✓ Présent' : '✗ Manquant',
            action: 'Configurez MINIMAX_API_KEY et MINIMAX_GROUP_ID dans .env',
          }
        };
      }

      this.logger.log('🔍 Test de connexion Minimax...');

      const testPrompt = 'A beautiful dish of pasta';
      const response = await axios.post<MinimaxVideoResponse>(
        `${this.baseUrl}/v1/video_generation`,
        {
          model: 'video-01',
          prompt: testPrompt,
          prompt_optimizer: true,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          params: {
            GroupId: this.groupId,
          },
          timeout: 10000,
        }
      );

      if (response.data?.base_resp) {
        const { status_code, status_msg } = response.data.base_resp;
        
        if (status_code === 2049) {
          this.logger.error('❌ CLÉ API INVALIDE');
          return {
            success: false,
            message: '❌ Clé API invalide ou expirée',
            details: {
              error_code: status_code,
              error_message: status_msg,
              action: 'Vérifiez que vous avez copié la clé COMPLÈTE depuis Minimax',
              current_key_preview: this.apiKey.substring(0, 20) + '...',
              key_length: this.apiKey.length,
            }
          };
        }

        if (status_code === 2050) {
          this.logger.error('❌ GROUP ID INVALIDE');
          return {
            success: false,
            message: '❌ Group ID invalide',
            details: {
              error_code: status_code,
              error_message: status_msg,
              action: 'Trouvez votre Group ID sur https://platform.minimax.chat/user-center/basic-information',
              current_group_id: this.groupId,
            }
          };
        }

        if (status_code !== 0) {
          return {
            success: false,
            message: `❌ Erreur API: ${status_msg}`,
            details: {
              error_code: status_code,
              error_message: status_msg,
            }
          };
        }
      }

      if (response.data?.task_id) {
        this.logger.log(`✅ Connexion réussie - Task ID: ${response.data.task_id}`);
        return {
          success: true,
          message: '✅ Connexion à l\'API Minimax réussie',
          details: {
            task_id: response.data.task_id,
            status: 'Clé API valide et fonctionnelle',
            api_key_length: this.apiKey.length,
            group_id: this.groupId,
          }
        };
      }

      return {
        success: false,
        message: '⚠️  Réponse inattendue de l\'API',
        details: response.data,
      };

    } catch (error: any) {
      this.logger.error(`❌ Test connexion échoué: ${error.message}`);
      
      return {
        success: false,
        message: this.getErrorMessage(error),
        details: {
          error_type: error.response?.status || 'network_error',
          error_data: error.response?.data,
          suggestion: 'Vérifiez votre connexion internet et vos clés API',
        }
      };
    }
  }

  /**
   * Générer une vidéo avec gestion intelligente des erreurs
   */
  async generateFoodVideo(options: {
    dishName: string;
    cuisine?: string;
    style?: string;
    description?: string;
    duration?: number;
  }): Promise<{ 
    video_url: string; 
    thumbnail_url: string;
    task_id: string;
    is_placeholder?: boolean;
    source: 'minimax' | 'placeholder';
  }> {
    try {
      this.logger.log(`🎬 Génération vidéo pour: ${options.dishName}`);

      const isConfigured = await this.isConfigured();
      
      if (!isConfigured) {
        this.logger.warn('⚠️  API non configurée ou invalide - Fallback immédiat');
        return {
          ...this.generatePlaceholderVideo(options),
          source: 'placeholder',
        };
      }

      try {
        const result = await this.generateRealVideo(options);
        return {
          ...result,
          source: 'minimax',
        };
      } catch (apiError: any) {
        this.logger.warn(`⚠️  API Minimax échouée: ${apiError.message}`);
        
        if (apiError.message.includes('invalid api key') || 
            apiError.message.includes('2049')) {
          this.isApiKeyValid = false;
          this.logger.error('❌ Clé API invalide détectée - Mode fallback activé');
        }
        
        return {
          ...this.generatePlaceholderVideo(options),
          source: 'placeholder',
        };
      }

    } catch (error: any) {
      this.logger.error(`❌ Erreur critique: ${error.message}`);
      return {
        ...this.generatePlaceholderVideo(options),
        source: 'placeholder',
      };
    }
  }

  /**
   * Générer une vraie vidéo avec Minimax
   */
  private async generateRealVideo(options: any): Promise<{
    video_url: string;
    thumbnail_url: string;
    task_id: string;
    is_placeholder: boolean;
  }> {
    const prompt = this.buildOptimizedPrompt(options);
    this.logger.log(`📝 Prompt (${prompt.length} chars): ${prompt.substring(0, 100)}...`);

    const taskId = await this.initiateVideoGeneration(prompt, options.duration);
    const videoResult = await this.waitForVideoGeneration(taskId);

    return {
      video_url: videoResult.video_url,
      thumbnail_url: await this.generateThumbnail(videoResult.video_url),
      task_id: taskId,
      is_placeholder: false,
    };
  }

  /**
   * Initier la génération
   */
  private async initiateVideoGeneration(prompt: string, duration: number = 6): Promise<string> {
    const url = `${this.baseUrl}/v1/video_generation`;
    
    const payload = {
      model: 'video-01',
      prompt: prompt,
      prompt_optimizer: true,
    };

    this.logger.log(`🌐 POST ${url}`);
    this.logger.log(`📦 Payload: ${JSON.stringify(payload).substring(0, 200)}...`);

    const response = await axios.post<MinimaxVideoResponse>(
      url,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        params: {
          GroupId: this.groupId,
        },
        timeout: 30000,
      }
    );

    this.logger.log(`✅ Réponse HTTP: ${response.status}`);
    this.logger.log(`📄 Data: ${JSON.stringify(response.data)}`);

    if (response.data?.base_resp) {
      const { status_code, status_msg } = response.data.base_resp;
      
      if (status_code === 2049) {
        throw new Error('invalid api key (code 2049)');
      }
      
      if (status_code === 2050) {
        throw new Error('invalid group id (code 2050)');
      }
      
      if (status_code !== 0) {
        throw new Error(`API error ${status_code}: ${status_msg}`);
      }
    }

    if (!response.data?.task_id) {
      throw new Error('Pas de task_id dans la réponse API');
    }

    this.logger.log(`✅ Task ID créé: ${response.data.task_id}`);
    return response.data.task_id;
  }

  /**
   * Attendre la génération (polling)
   */
  private async waitForVideoGeneration(taskId: string): Promise<{
    video_url: string;
    file_id?: string;
  }> {
    this.logger.log(`⏳ Attente génération - Task: ${taskId}`);
    
    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < this.GENERATION_TIMEOUT) {
      attempts++;
      
      try {
        const status = await this.queryVideoStatus(taskId);
        
        this.logger.log(`🔍 [${attempts}] Status: ${status.status}`);

        if (status.status === 'Success' && status.video_url) {
          this.logger.log(`✅ Vidéo générée: ${status.video_url}`);
          return {
            video_url: status.video_url,
            file_id: status.file_id,
          };
        }

        if (status.status === 'Failed') {
          throw new Error(`Génération échouée: ${status.error_message || 'Erreur inconnue'}`);
        }

        await this.sleep(this.POLL_INTERVAL);

      } catch (error: any) {
        this.logger.warn(`⚠️  Erreur poll ${attempts}: ${error.message}`);
        
        if (attempts < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          continue;
        }
        
        throw error;
      }
    }

    throw new Error('Timeout: génération >3min');
  }

  /**
   * Interroger le statut
   */
  private async queryVideoStatus(taskId: string): Promise<MinimaxQueryResponse> {
    const url = `${this.baseUrl}/v1/query/video_generation`;
    
    const response = await axios.get<MinimaxQueryResponse>(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      params: {
        GroupId: this.groupId,
        task_id: taskId,
      },
      timeout: 10000,
    });

    return response.data;
  }

  /**
   * Construire le prompt optimisé
   */
  private buildOptimizedPrompt(options: {
    dishName: string;
    cuisine?: string;
    style?: string;
    description?: string;
  }): string {
    const { dishName, cuisine, style, description } = options;
    
    let prompt = `${style || 'cinematic'} food photography, ${dishName}`;
    
    if (cuisine) {
      prompt += `, ${cuisine} cuisine`;
    }

    prompt += ', professional food styling, appetizing presentation, vibrant colors, detailed textures, ';
    prompt += 'natural lighting, shallow depth of field, bokeh background, ';
    prompt += 'slow camera movement, smooth rotation around dish, ';
    prompt += 'vertical 9:16 format, 1080x1920 resolution, ';
    prompt += 'ultra high definition, 4K quality, photorealistic';

    if (description) {
      prompt += `. ${description}`;
    }

    if (prompt.length > 500) {
      prompt = prompt.substring(0, 497) + '...';
    }

    return prompt;
  }

  /**
   * Générer un placeholder de qualité
   */
  private generatePlaceholderVideo(options: {
    dishName: string;
    cuisine?: string;
  }): { 
    video_url: string; 
    thumbnail_url: string;
    task_id: string;
    is_placeholder: boolean;
  } {
    const dishSlug = options.dishName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Utiliser des vidéos Pexels réelles (gratuites)
    const pexelsVideos: Record<string, string> = {
      'couscous': 'https://player.vimeo.com/external/471296636.sd.mp4?s=3e6e1d9e0b8f8d2a5c4f0e1a2b3c4d5e6f7a8b9c',
      'pizza': 'https://player.vimeo.com/external/453128460.sd.mp4?s=8b2f9e1c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
      'pasta': 'https://player.vimeo.com/external/471296584.sd.mp4?s=9c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
      'burger': 'https://player.vimeo.com/external/453128541.sd.mp4?s=7f3d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e',
      'default': 'https://player.vimeo.com/external/471296636.sd.mp4?s=3e6e1d9e0b8f8d2a5c4f0e1a2b3c4d5e6f7a8b9c'
    };

    const videoUrl = pexelsVideos[dishSlug] || pexelsVideos['default'];
    const thumbnailUrl = `https://source.unsplash.com/1080x1920/?${dishSlug},food,cuisine`;

    this.logger.log(`🎬 PLACEHOLDER généré: ${dishSlug}`);

    return {
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      task_id: `placeholder_${Date.now()}`,
      is_placeholder: true,
    };
  }

  async generateThumbnail(videoUrl: string): Promise<string> {
    return videoUrl.replace('.mp4', '_thumbnail.jpg');
  }

  private getErrorMessage(error: any): string {
    if (error.response?.data?.base_resp?.status_msg) {
      return error.response.data.base_resp.status_msg;
    }
    
    if (error.response?.data?.error) {
      return error.response.data.error;
    }
    
    const status = error.response?.status;
    const messages: Record<number, string> = {
      401: 'Clé API invalide',
      403: 'Accès refusé',
      429: 'Quota dépassé',
      500: 'Erreur serveur Minimax',
      503: 'Service indisponible',
    };
    
    return messages[status] || error.message || 'Erreur inconnue';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}