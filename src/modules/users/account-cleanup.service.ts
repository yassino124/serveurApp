import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UsersService } from './users.service';

@Injectable()
export class AccountCleanupService {
  private readonly logger = new Logger(AccountCleanupService.name);

  constructor(private readonly usersService: UsersService) {}

  // ✅ Exécuter tous les jours à 3h du matin
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleAccountCleanup() {
    this.logger.log('🗑️ Starting account cleanup job...');

    try {
      const result = await this.usersService.permanentlyDeleteExpiredAccounts();

      if (result.deleted_count > 0) {
        this.logger.warn(
          `✅ Deleted ${result.deleted_count} expired accounts: ${result.deleted_emails.join(', ')}`
        );
      } else {
        this.logger.log('✅ No expired accounts to delete');
      }
    } catch (error) {
      this.logger.error('❌ Account cleanup job failed:', error);
    }
  }

  // ✅ Pour tester manuellement (à retirer en production)
  // @Cron(CronExpression.EVERY_MINUTE)
  // async testCleanup() {
  //   this.logger.log('🧪 [TEST] Running manual cleanup check...');
  //   await this.handleAccountCleanup();
  // }
}