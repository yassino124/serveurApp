// src/modules/websocket/websocket.module.ts - VERSION FINALE
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrdersGateway } from './orders.gateway';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET', 'changeme');
        
        console.log('🔑 Configuration JWT chargée:');
        console.log('   Secret:', secret ? '✓ Défini' : '✗ Utilisation valeur par défaut');
        console.log('   ExpiresIn: 24h');
        
        return {
          secret: secret,
          signOptions: { 
            expiresIn: '24h' // ✅ String valide pour JWT
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [OrdersGateway],
  exports: [OrdersGateway],
})
export class WebSocketModule {}