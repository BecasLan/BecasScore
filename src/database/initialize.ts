/**
 * DATABASE INITIALIZATION SCRIPT
 *
 * Run this script to:
 * 1. Test database connections (PostgreSQL + Redis)
 * 2. Run pending migrations
 * 3. Verify schema is set up correctly
 */

import { initializeDatabase, testConnections, closeConnections } from './config';
import { runMigrations } from './migrate';
import { createLogger } from '../services/Logger';

const logger = createLogger('DatabaseInit');

async function initialize() {
  logger.info('🚀 Starting database initialization...');

  try {
    // Step 1: Test connections
    logger.info('📡 Testing connections...');
    const connectionStatus = await testConnections();

    if (!connectionStatus.postgres) {
      throw new Error('PostgreSQL connection failed! Make sure Docker containers are running.');
    }

    if (!connectionStatus.redis) {
      logger.warn('⚠️ Redis connection failed. Cache layer will be disabled.');
    } else {
      logger.info('✅ Redis connected');
    }

    logger.info('✅ PostgreSQL connected');

    // Step 2: Initialize database (create schema if needed)
    logger.info('🔧 Initializing database schema...');
    await initializeDatabase();
    logger.info('✅ Database schema initialized');

    // Step 3: Run migrations
    logger.info('📦 Running migrations...');
    await runMigrations();
    logger.info('✅ All migrations completed');

    // Step 4: Verify setup
    logger.info('🔍 Verifying database setup...');
    const { getPostgresPool } = await import('./config');
    const pool = getPostgresPool();

    // Check table count
    const tableResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tableCount = parseInt(tableResult.rows[0].count);

    logger.info(`📊 Found ${tableCount} tables in database`);

    if (tableCount < 18) {
      logger.warn(`⚠️ Expected at least 18 tables, but found ${tableCount}. Some migrations may have failed.`);
    } else {
      logger.info('✅ All tables created successfully');
    }

    // Success!
    logger.info('');
    logger.info('🎉 Database initialization complete!');
    logger.info('');
    logger.info('📊 Summary:');
    logger.info(`   - PostgreSQL: ✅ Connected`);
    logger.info(`   - Redis: ${connectionStatus.redis ? '✅ Connected' : '⚠️ Disabled'}`);
    logger.info(`   - Tables: ${tableCount}`);
    logger.info(`   - Migrations: ✅ Up to date`);
    logger.info('');
    logger.info('🚀 Ready to start Becas with database integration!');

  } catch (error) {
    logger.error('❌ Database initialization failed:', error);
    logger.error('');
    logger.error('Troubleshooting steps:');
    logger.error('1. Make sure Docker is running');
    logger.error('2. Run: docker-compose up -d');
    logger.error('3. Check .env file for correct credentials');
    logger.error('4. Check logs: docker-compose logs postgres redis');
    process.exit(1);
  } finally {
    // Clean up connections
    await closeConnections();
  }
}

// Run if called directly
if (require.main === module) {
  initialize().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { initialize };
