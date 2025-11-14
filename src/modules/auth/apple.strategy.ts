import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-apple';
import { SocialAuthService } from './social-auth.service';
import { SocialProvider } from './dto/social-login.dto';

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  constructor(private socialAuthService: SocialAuthService) { // ✅ Utiliser SocialAuthService
    super({
      clientID: process.env.APPLE_CLIENT_ID,
      teamID: process.env.APPLE_TEAM_ID,
      keyID: process.env.APPLE_KEY_ID,
      privateKey: process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      callbackURL: process.env.APPLE_CALLBACK_URL,
      scope: ['email', 'name'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, email, name } = profile;
    
    const user = {
      provider: 'apple',
      provider_id: id,
      email: email,
      name: name ? `${name.firstName} ${name.lastName}` : 'Apple User',
      accessToken,
    };

    try {
      // ✅ Utiliser SocialAuthService.socialLogin qui existe déjà
      const result = await this.socialAuthService.socialLogin({
        provider: SocialProvider.APPLE,
        token: accessToken, // Utiliser le token d'accès Apple
        email: email,
        name: name ? `${name.firstName} ${name.lastName}` : 'Apple User',
      });

      done(null, result.user); // Retourner l'utilisateur créé
    } catch (error) {
      done(error, null);
    }
  }
}