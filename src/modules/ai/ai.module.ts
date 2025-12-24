import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MinimaxVideoService } from './minimax-video.service';
import { ReelsAIService } from './reels-ai.service';
import { ContentModerationService } from '../reels/content-moderation.service';
import { Reel, ReelSchema } from '../reels/reel.schema';
import { User, UserSchema } from '../users/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reel.name, schema: ReelSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [
    MinimaxVideoService,
    ReelsAIService,
    ContentModerationService,
  ],
  exports: [
    MinimaxVideoService,
    ReelsAIService,
    ContentModerationService,
  ],
})
export class AIModule {}