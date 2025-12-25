// 5. src/modules/upload/upload.module.ts (NOUVEAU)
// ================================
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UploadController } from './upload.controller';
import { CloudinaryService } from './cloudinary.service';
import { CloudinaryProvider } from '../../config/cloudinary.config';

@Module({
  imports: [ConfigModule],
  controllers: [UploadController],
  providers: [CloudinaryService, CloudinaryProvider],
  exports: [CloudinaryService], // ✅ Exporter pour réutiliser dans d'autres modules
})
export class UploadModule {}
