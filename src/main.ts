// src/main.ts - VERSION CORRIGÉE POUR RENDER
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

  // ✅ CONFIGURATION WEBSOCKET
  app.useWebSocketAdapter(new IoAdapter(app));

  // ✅ CRITIQUE: Utiliser /tmp pour les uploads sur Render (filesystem éphémère)
  const uploadPath = process.env.UPLOAD_PATH || '/tmp/uploads';
  const uploadsDir = uploadPath;
  const videosDir = join(uploadsDir, 'videos');
  const thumbnailsDir = join(uploadsDir, 'thumbnails');

  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log('📁 Created uploads directory:', uploadsDir);
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
  } catch (error) {
    console.error('⚠️ Error creating upload directories:', error.message);
    console.log('⚠️ App will continue without file upload support');
  }

  // ✅ CORS configuration AMÉLIORÉE
  const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : [
        'http://localhost:3000',
        'http://localhost:3001', 
        'http://localhost:5173',
        'http://localhost:8081',
      ];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  });

  console.log('🌐 CORS enabled for origins:', allowedOrigins);

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

  // ✅ SWAGGER UI COMPLET (désactivé en production pour économiser la mémoire)
  if (process.env.NODE_ENV !== 'production' && process.env.DISABLE_SWAGGER !== 'true') {
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
    console.log('📚 Swagger Documentation enabled');
  }

  // ✅ CRITIQUE: Utiliser le PORT fourni par Render (dynamique)
  const port = process.env.PORT || 3000;
  const host = '0.0.0.0'; // Important pour Render
  
  await app.listen(port, host);

  console.log(`\n🚀 Server is running on: http://${host}:${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 Uploads path: ${uploadPath}`);
  console.log(`🔌 WebSocket Orders: ws://${host}:${port}/orders`);
  console.log(`✅ Application started successfully!\n`);
}

bootstrap().catch((error) => {
  console.error('❌ Error starting application:', error);
  process.exit(1);
});