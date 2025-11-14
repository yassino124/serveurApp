// src/upload/upload.controller.ts
import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  Logger,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'; // Chemin relatif correct
import { v4 as uuidv4 } from 'uuid';
import { ApiConsumes, ApiBody, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Upload')
@ApiBearerAuth('JWT-auth')
@Controller('api/upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  @Post('video')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file')) // Match Swift fieldName "file"
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    this.logger.log('📤 Upload video request received');

    try {
      if (!file) {
        throw new BadRequestException('No video file provided');
      }

      this.logger.log(`📹 File received: ${file.originalname}, Size: ${file.size} bytes, Type: ${file.mimetype}`);

      // Validation du type de fichier
      if (!file.mimetype.startsWith('video/')) {
        throw new BadRequestException('File must be a video');
      }

      // Validation de la taille
      const MAX_SIZE = 100 * 1024 * 1024; // 100MB
      if (file.size > MAX_SIZE) {
        throw new BadRequestException('File too large. Maximum size is 100MB');
      }

      // Générer des URLs simulées (à remplacer par votre logique cloud réelle)
      const videoId = uuidv4();
      const videoUrl = `https://your-storage-bucket.s3.amazonaws.com/videos/${videoId}.mp4`;
      const thumbnailUrl = `https://your-storage-bucket.s3.amazonaws.com/thumbnails/${videoId}.jpg`;

      this.logger.log(`✅ Video uploaded successfully: ${videoId}`);

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Video uploaded successfully',
        data: {
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl,
          file_size: file.size,
          mime_type: file.mimetype,
          video_id: videoId,
          original_name: file.originalname,
        },
      };
    } catch (error) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw error;
    }
  }

  @Post('thumbnail')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('thumbnail'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        thumbnail: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadThumbnail(@UploadedFile() thumbnail: Express.Multer.File) {
    this.logger.log('🖼️ Upload thumbnail request received');

    try {
      if (!thumbnail) {
        throw new BadRequestException('No thumbnail file provided');
      }

      this.logger.log(`📸 Thumbnail received: ${thumbnail.originalname}, Size: ${thumbnail.size} bytes, Type: ${thumbnail.mimetype}`);

      // Validation du type de fichier
      if (!thumbnail.mimetype.startsWith('image/')) {
        throw new BadRequestException('File must be an image');
      }

      // Validation de la taille
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (thumbnail.size > MAX_SIZE) {
        throw new BadRequestException('Thumbnail too large. Maximum size is 10MB');
      }

      // Générer une URL simulée
      const thumbnailId = uuidv4();
      const thumbnailUrl = `https://your-storage-bucket.s3.amazonaws.com/thumbnails/${thumbnailId}.jpg`;

      this.logger.log(`✅ Thumbnail uploaded successfully: ${thumbnailId}`);

      return {
        statusCode: HttpStatus.CREATED,
        message: 'Thumbnail uploaded successfully',
        data: {
          thumbnail_url: thumbnailUrl,
          file_size: thumbnail.size,
          mime_type: thumbnail.mimetype,
          thumbnail_id: thumbnailId,
          original_name: thumbnail.originalname,
        },
      };
    } catch (error) {
      this.logger.error(`Thumbnail upload failed: ${error.message}`);
      throw error;
    }
  }
}