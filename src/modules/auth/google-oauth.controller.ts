import { 
  Controller, 
  Get, 
  Req, 
  Res, 
  UseGuards, 
  Logger,
  Post,
  Body,
  Query,
  InternalServerErrorException
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SocialAuthService } from './social-auth.service';
import { SocialProvider } from './dto/social-login.dto';
import type { Response, Request } from 'express';

@ApiTags('Google OAuth')
@Controller('auth/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);
  
  constructor(private readonly socialAuthService: SocialAuthService) {}

  /**
   * 🚀 Étape 1 : Démarrage de l'authentification Google (pour le web)
   */
  @Public()
  @Get()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Démarrer la connexion Google OAuth' })
  async googleAuth(@Req() req) {
    // L'appel est automatiquement redirigé vers Google par Passport
  }

  /**
   * 🚀 Étape 2 : Callback Google OAuth (web + mobile)
   */
  @Public()
  @Get('callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Callback Google OAuth (web + mobile)' })
  async googleAuthRedirect(@Req() req: Request, @Res() res: Response, @Query('platform') platform?: string) {
    try {
      const googleUser = req.user as any;
      this.logger.log(`🔐 Google OAuth callback received: ${googleUser?.email}`);

      const result = await this.socialAuthService.socialLogin({
        provider: SocialProvider.GOOGLE,
        token: googleUser.accessToken,
        email: googleUser.email,
        name: googleUser.name,
      });

      const jwtToken = result.access_token;
      this.logger.log(`✅ Google OAuth success for user: ${googleUser.email}`);

      // ✅ Si c’est un mobile, on redirige vers une URL personnalisée
      if (platform === 'mobile') {
        const redirectURL = `myapp://auth?token=${jwtToken}`;
        this.logger.log(`📱 Redirecting to mobile app: ${redirectURL}`);
        return res.redirect(redirectURL);
      }

      // ✅ Sinon, on renvoie la réponse JSON (web)
      return res.json({
        success: true,
        message: 'Google authentication successful',
        data: result
      });

    } catch (error) {
      this.logger.error(`💥 Google OAuth error: ${error.message}`);

      return res.status(500).json({
        success: false,
        message: 'Google authentication failed',
        error: error.message
      });
    }
  }

  /**
   * 📱 Route dédiée pour l'app mobile (Google Sign-In SDK)
   */
  @Public()
  @Post('mobile')
  @ApiOperation({ summary: 'Google Sign-In pour application mobile' })
  async googleMobileLogin(@Body() body: { email?: string; name?: string; idToken?: string }) {
    try {
      const email = body.email || `user_${Date.now()}@gmail.com`;
      const name = body.name || 'Google User';

      this.logger.log(`🔐 Google Mobile Sign-In: ${email}`);

      const result = await this.socialAuthService.socialLogin({
        provider: SocialProvider.GOOGLE,
        token: body.idToken || 'mobile_google_token_' + Date.now(),
        email,
        name,
      });

      return {
        success: true,
        message: 'Google mobile sign-in successful',
        data: result
      };

    } catch (error) {
      this.logger.error(`💥 Google Mobile Sign-In error: ${error.message}`);
      throw new InternalServerErrorException('Google mobile authentication failed');
    }
  }
}