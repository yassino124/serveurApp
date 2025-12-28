// src/main.ts - VERSION OPTIMISÉE POUR RENDER
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'production' 
      ? ['error', 'warn'] 
      : ['log', 'error', 'warn', 'debug'],
  });

  // ✅ CONFIGURATION WEBSOCKET
  app.useWebSocketAdapter(new IoAdapter(app));

  // ✅ Cloudinary est utilisé pour les uploads (pas besoin de dossiers locaux)
  console.log('☁️ Using Cloudinary for file uploads');

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

  // ✅ SWAGGER - Désactivé en production pour économiser la mémoire
  if (process.env.NODE_ENV !== 'production') {
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
      .addTag('Reels', 'Endpoints pour la gestion des reels')
      .addTag('Upload', 'Endpoints pour l\'upload de vidéos et miniatures')
      .addTag('Social', 'Endpoints pour les interactions sociales')
      .addTag('Feed', 'Endpoints pour les feeds personnalisés')
      .addTag('Orders', 'Endpoints pour le système de commandes')
      .addTag('Payments', 'Endpoints pour les paiements et wallet')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'none',
      },
    });
    console.log('📚 Swagger Documentation enabled at /api');
  } else {
    console.log('📚 Swagger disabled in production (memory optimization)');
  }

  // ✅ CRITIQUE: Utiliser le PORT fourni par Render (dynamique)
  const port = process.env.PORT || 3000;
  const host = '0.0.0.0'; // Important pour Render
  
  await app.listen(port, host);

  console.log(`\n🚀 Server running on: http://${host}:${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`☁️ Uploads: Cloudinary`);
  console.log(`🔌 WebSocket: ws://${host}:${port}/orders`);
  console.log(`✅ Application started successfully!\n`);
}

bootstrap().catch((error) => {
  console.error('❌ Error starting application:', error);
  process.exit(1);
});