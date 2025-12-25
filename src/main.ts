// src/main.ts - VERSION CORRIGÉE AVEC WEBSOCKET
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as fs from 'fs';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ✅ CONFIGURATION WEBSOCKET (AJOUT CRITIQUE)
  app.useWebSocketAdapter(new IoAdapter(app));

  // ✅ CRITIQUE: Créer les dossiers uploads s'ils n'existent pas
  const uploadsDir = join(__dirname, '..', 'uploads');
  const videosDir = join(uploadsDir, 'videos');
  const thumbnailsDir = join(uploadsDir, 'thumbnails');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('📁 Created uploads directory');
  }
  if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
    console.log('📁 Created uploads/videos directory');
  }
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
    console.log('📁 Created uploads/thumbnails directory');
  }

  // ✅ CRITIQUE: Servir les fichiers statiques
  app.useStaticAssets(uploadsDir, {
    prefix: '/uploads/',
    index: false,
  });

  console.log('📂 Static files served from:', uploadsDir);
  console.log('🌐 Access videos at: http://localhost:3000/uploads/videos/filename.mp4');

  // ✅ CORS configuration AMÉLIORÉE POUR WEBSOCKET
  app.enableCors({
    origin: process.env.CORS_ORIGIN || [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      'http://localhost:8081',
      'https://your-production-domain.com'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  });

  // ✅ Validation globale
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const uploadPath = process.env.UPLOAD_PATH || './uploads';
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }

  // ✅ SWAGGER UI COMPLET
  const config = new DocumentBuilder()
    .setTitle('PlateNet Food Reels API')
    .setDescription('API REST pour la plateforme sociale de reels culinaires PlateNet')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Entrez votre token JWT',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Authentication', 'Endpoints pour inscription, connexion et gestion des utilisateurs')
    .addTag('Reels', 'Endpoints pour la gestion des reels (création, modification, suppression)')
    .addTag('Upload', 'Endpoints pour l\'upload de vidéos et miniatures')
    .addTag('Social', 'Endpoints pour les interactions sociales (like, save, follow)')
    .addTag('Feed', 'Endpoints pour les feeds personnalisés (For You, Trending)')
    .addTag('Orders', 'Endpoints pour le système de commandes et tracking')
    .addTag('Payments', 'Endpoints pour les paiements et wallet')
    .addServer('http://localhost:3000', 'Serveur de développement')
    .addServer('https://api.platenet.com', 'Serveur de production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
    customSiteTitle: 'PlateNet API Documentation',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 20px 0; }
      .swagger-ui .info .title { color: #ff6b35; }
    `,
  });

  const port = process.env.PORT || 3000;
await app.listen(port, '0.0.0.0');

  console.log(`\n🚀 Server is running on: http://localhost:${port}`);
  console.log(`📚 Swagger Documentation: http://localhost:${port}/api`);
  console.log(`📁 Uploads accessible at: http://localhost:${port}/uploads/`);
  console.log(`🔌 WebSocket Orders: ws://localhost:${port}/orders`);
  console.log(`🎯 Order Tracking: Active avec notifications temps réel\n`);
  console.log(`✅ WebSocket adapter configured successfully!`);
}

bootstrap();