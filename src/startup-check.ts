/**
 * STARTUP CHECK - Verify database connection before starting Becas
 *
 * This script ensures that PostgreSQL and Redis are available
 * before starting the bot. Fails fast if database is not ready.
 */

import { testConnections } from './database/config';
import { createLogger } from './services/Logger';

const logger = createLogger('StartupCheck');

export async function verifyDatabaseConnection(): Promise<void> {
  // Skip database check if SKIP_DB_CHECK is set
  if (process.env.SKIP_DB_CHECK === 'true') {
    logger.warn('⚠️  Database check SKIPPED (SKIP_DB_CHECK=true)');
    logger.warn('   This is for testing only! Database operations will fail.');
    return;
  }

  logger.info('🔍 Checking database connections...');

  try {
    const results = await testConnections();

    if (!results.postgres) {
      logger.error('');
      logger.error('❌ FATAL ERROR: PostgreSQL is not available!');
      logger.error('');
      logger.error('Database is REQUIRED for Becas to run.');
      logger.error('All data (messages, trust scores, threats) must be persisted.');
      logger.error('');
      logger.error('Please fix the following:');
      logger.error('');
      logger.error('1. Start Docker containers:');
      logger.error('   docker-compose up -d');
      logger.error('');
      logger.error('2. Initialize database:');
      logger.error('   npm run db:init');
      logger.error('');
      logger.error('3. Verify .env configuration:');
      logger.error('   DB_HOST=localhost');
      logger.error('   DB_PORT=5432');
      logger.error('   DB_NAME=becas_db');
      logger.error('   DB_USER=becas');
      logger.error('   DB_PASSWORD=becas_secure_password_2025');
      logger.error('');

      throw new Error('PostgreSQL connection required but not available');
    }

    logger.info('✅ PostgreSQL: Connected');

    if (!results.redis) {
      logger.warn('⚠️  Redis: Not connected (caching disabled)');
      logger.warn('   Becas will work but without performance optimization.');
      logger.warn('   Consider starting Redis: docker-compose up -d redis');
    } else {
      logger.info('✅ Redis: Connected');
    }

    logger.info('');
    logger.info('✅ Database connections verified!');
    logger.info('🚀 Ready to start Becas');
    logger.info('');

  } catch (error) {
    logger.error('Database connection check failed:', error);
    throw error;
  }
}

// Run check if called directly
if (require.main === module) {
  verifyDatabaseConnection()
    .then(() => {
      logger.info('✅ All checks passed');
      process.exit(0);
    })
    .catch(error => {
      logger.error('❌ Startup check failed:', error);
      process.exit(1);
    });
}
