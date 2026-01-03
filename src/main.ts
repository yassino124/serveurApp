// src/main.ts - VERSION OPTIMISÉE POUR RENDER (Cloudinary)
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ✅ CONFIGURATION WEBSOCKET
  app.useWebSocketAdapter(new IoAdapter(app));

  // ✅ CORS - Configuration dynamique selon l'environnement
  const isProduction = process.env.NODE_ENV === 'production';
  
  app.enableCors({
    origin: isProduction 
      ? [
          process.env.FRONTEND_URL || 'https://your-app.vercel.app',
          process.env.CORS_ORIGIN || '*',
        ]
      : [
          'http://localhost:3000',
          'http://localhost:3001', 
          'http://localhost:5173',
          'http://localhost:8081',
        ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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

  // ✅ SWAGGER UI - Configuration complète
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
    .addTag('Upload', 'Endpoints pour l\'upload de vidéos et miniatures vers Cloudinary')
    .addTag('Social', 'Endpoints pour les interactions sociales (like, save, follow)')
    .addTag('Feed', 'Endpoints pour les feeds personnalisés (For You, Trending)')
    .addTag('Orders', 'Endpoints pour le système de commandes et tracking')
    .addTag('Payments', 'Endpoints pour les paiements et wallet')
    .addServer(
      isProduction 
        ? process.env.API_URL || 'https://your-api.onrender.com'
        : 'http://localhost:3000', 
      isProduction ? 'Production' : 'Development'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // ✅ Swagger UI avec style personnalisé
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
      .swagger-ui .scheme-container { 
        background: #fafafa; 
        padding: 15px; 
        border-radius: 4px; 
      }
    `,
  });

  // ✅ PORT - Utiliser celui de Render ou 3000 en local
  const port = process.env.PORT || 3000;
  
  // ✅ CRITIQUE: Écouter sur 0.0.0.0 pour Render
  await app.listen(port, '0.0.0.0');

  // ✅ Logs de démarrage
  console.log('\n🎉 ============================================');
  console.log('🚀 PlateNet API - SUCCESSFULLY STARTED');
  console.log('============================================');
  console.log(`📌 Environment: ${isProduction ? '🔴 PRODUCTION' : '🟢 DEVELOPMENT'}`);
  console.log(`🌐 Server: http://localhost:${port}`);
  console.log(`📚 API Docs: http://localhost:${port}/api`);
  console.log(`☁️  Storage: Cloudinary (videos & images)`);
  console.log(`🔌 WebSocket: ws://localhost:${port}/orders`);
  console.log(`✅ CORS: ${isProduction ? 'Production domains' : 'Local development'}`);
  console.log('============================================\n');

  // ✅ Vérification des variables d'environnement critiques
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'GEMINI_API_KEY',
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('⚠️  WARNING: Missing environment variables:');
    missingVars.forEach(varName => {
      console.error(`   ❌ ${varName}`);
    });
    console.error('\n');
  } else {
    console.log('✅ All required environment variables are set\n');
  }
}

bootstrap();