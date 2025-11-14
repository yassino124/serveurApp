// src/app.module.ts
import { Module, MiddlewareConsumer, NestModule, OnModuleInit } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ReelsModule } from './modules/reels/reels.module';
import { UploadModule } from './upload.module'; // ← Chemin corrigé

import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI') || 'mongodb://localhost:27017/platenet',
      }),
    }),
    AuthModule,
    UsersModule,
    ReelsModule,
    UploadModule, // ← Doit pointer vers le bon chemin
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: HttpErrorFilter,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  onModuleInit() {
    this.logger.log('🔧 Modules chargés:');
    this.logger.log('   ✅ AuthModule');
    this.logger.log('   ✅ UsersModule'); 
    this.logger.log('   ✅ ReelsModule');
    this.logger.log('   ✅ UploadModule'); // ← Ajouté
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}