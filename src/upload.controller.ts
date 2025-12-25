// src/modules/upload/upload.controller.ts
/*import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Logger,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Upload')
@ApiBearerAuth('JWT-auth')
@Controller('api/upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  @Post('video')
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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/videos',
        filename: (req, file, callback) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname);
          const filename = `video-${uniqueSuffix}${ext}`;
          callback(null, filename);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('video/')) {
          return callback(
            new BadRequestException('Only video files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
    }),
  )
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    this.logger.log('📤 ============ VIDEO UPLOAD ============');
    
    if (!file) {
      this.logger.error('❌ No file uploaded');
      throw new BadRequestException('No file uploaded');
    }

    this.logger.log(`📹 File received: ${file.originalname}`);
    this.logger.log(`📏 Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    this.logger.log(`📦 MIME type: ${file.mimetype}`);
    this.logger.log(`💾 Saved as: ${file.filename}`);
    this.logger.log(`📂 Path: ${file.path}`);

    // ✅ CRITIQUE: Construire l'URL complète accessible
    const baseURL = process.env.BASE_URL || 'http://localhost:3000';
    const videoURL = `${baseURL}/uploads/videos/${file.filename}`;

    this.logger.log(`🌐 Video URL: ${videoURL}`);
    this.logger.log('✅ ============ UPLOAD SUCCESS ============');

    return {
      statusCode: HttpStatus.OK,
      message: 'Video uploaded successfully',
      data: {
        video_url: videoURL,
        thumbnail_url: null, // TODO: Générer une thumbnail
        file_size: file.size,
        mime_type: file.mimetype,
        original_name: file.originalname,
        video_id: file.filename,
      },
    };
  }

  @Post('thumbnail')
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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/thumbnails',
        filename: (req, file, callback) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname);
          const filename = `thumb-${uniqueSuffix}${ext}`;
          callback(null, filename);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  async uploadThumbnail(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const baseURL = process.env.BASE_URL || 'http://localhost:3000';
    const thumbnailURL = `${baseURL}/uploads/thumbnails/${file.filename}`;

    this.logger.log(`📸 Thumbnail uploaded: ${thumbnailURL}`);

    return {
      statusCode: HttpStatus.OK,
      message: 'Thumbnail uploaded successfully',
      data: {
        thumbnail_url: thumbnailURL,
        file_size: file.size,
        mime_type: file.mimetype,
      },
    };
  }
}*/