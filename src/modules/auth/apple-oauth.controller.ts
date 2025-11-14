import { Controller, Get, Req, Res, UseGuards, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SocialAuthService } from './social-auth.service';
import { SocialProvider } from './dto/social-login.dto';

@ApiTags('Apple OAuth')
@Controller('auth/apple')
export class AppleOAuthController {
  private readonly logger = new Logger(AppleOAuthController.name);
  
  constructor(private readonly socialAuthService: SocialAuthService) {}

  @Public()
  @Get()
  @UseGuards(AuthGuard('apple'))
  @ApiOperation({ summary: 'Démarrer la connexion Apple' })
  async appleAuth(@Req() req) {
    // Déclenché automatiquement par Passport
  }

  @Public()
  @Get('callback')
  @UseGuards(AuthGuard('apple'))
  @ApiOperation({ summary: 'Callback Apple OAuth' })
  async appleAuthRedirect(@Req() req, @Res() res: Response) {
    try {
      const appleUser = req.user;
      this.logger.log(`🔐 Apple OAuth callback received: ${appleUser?.email}`);

      const result = await this.socialAuthService.socialLogin({
        provider: SocialProvider.APPLE,
        token: appleUser.accessToken,
        email: appleUser.email,
        name: appleUser.name,
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const jwtToken = result.access_token;
      
      this.logger.log(`✅ Apple OAuth SUCCESS for: ${appleUser.email}`);
      
      return res.redirect(`${frontendUrl}/api?token=${jwtToken}&message=apple_auth_success`);
      
    } catch (error) {
      this.logger.error(`💥 Apple OAuth error: ${error.message}`);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/api?error=apple_auth_failed`);
    }
  }
}