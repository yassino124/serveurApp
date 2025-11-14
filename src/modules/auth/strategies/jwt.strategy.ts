import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/user.schema';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private configService: ConfigService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true, // ✅ Nécessaire pour accéder à `request`
    };

    super(options);
  }

  // ✅ Correction : ajouter `request` en paramètre
  async validate(request: Request, payload: JwtPayload) {
    const user = await this.userModel
      .findById(payload.sub)
      .select('-password_hash')
      .exec();

    if (!user) {
      throw new UnauthorizedException('Utilisateur non trouvé');
    }

    // ✅ On peut maintenant utiliser `request.url`
    const requestUrl = request.url || '';

    const allowedSuspendedRoutes = [
      '/users/reactivate',
      '/users/recover',
    ];

    const isAllowedRoute = allowedSuspendedRoutes.some(route =>
      requestUrl.includes(route),
    );

    if (user.account_status === 'banned') {
      throw new UnauthorizedException('Compte banni définitivement');
    }

    if (
      (user.account_status === 'suspended' ||
        user.account_status === 'pending_deletion') &&
      !isAllowedRoute
    ) {
      throw new UnauthorizedException(
        user.account_status === 'pending_deletion'
          ? 'Compte en cours de suppression. Utilisez /users/recover pour annuler.'
          : 'Compte suspendu. Utilisez /users/reactivate pour le réactiver.',
      );
    }

    return {
      user_id: String(user._id),
      email: user.email,
      role: user.role,
      username: user.username,
      account_status: user.account_status,
    };
  }
}
