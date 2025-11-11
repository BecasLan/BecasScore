/**
 * DATABASE MIGRATION RUNNER
 *
 * Runs all SQL migrations in order
 */

import 'dotenv/config';
import { getPostgresPool, closeConnections } from './config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../services/Logger';

const logger = createLogger('MigrationRunner');

interface Migration {
  id: number;
  name: string;
  path: string;
}

async function getMigrationFiles(): Promise<Migration[]> {
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Files are already numbered (001_, 002_, etc.)

  return files.map((file, index) => ({
    id: index + 1,
    name: file,
    path: join(migrationsDir, file)
  }));
}

async function createMigrationsTable(): Promise<void> {
  const pool = getPostgresPool();

  const sql = `
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;

  await pool.query(sql);
  logger.info('✓ Migrations table ready');
}

async function getExecutedMigrations(): Promise<string[]> {
  const pool = getPostgresPool();

  const result = await pool.query('SELECT name FROM migrations ORDER BY id');
  return result.rows.map(row => row.name);
}

async function executeMigration(migration: Migration): Promise<void> {
  const pool = getPostgresPool();
  const sql = readFileSync(migration.path, 'utf-8');

  logger.info(`Running migration: ${migration.name}`);

  try {
    // Execute migration in a transaction
    await pool.query('BEGIN');
    await pool.query(sql);
    await pool.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
    await pool.query('COMMIT');

    logger.info(`✓ Migration ${migration.name} completed`);
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error(`✗ Migration ${migration.name} failed`, error);
    throw error;
  }
}

async function runMigrations(): Promise<void> {
  try {
    logger.info('🗄️ Starting database migrations...');

    // Create migrations tracking table
    await createMigrationsTable();

    // Get all migration files
    const allMigrations = await getMigrationFiles();
    logger.info(`Found ${allMigrations.length} migration files`);

    // Get already executed migrations
    const executedMigrations = await getExecutedMigrations();
    logger.info(`${executedMigrations.length} migrations already executed`);

    // Find pending migrations
    const pendingMigrations = allMigrations.filter(
      m => !executedMigrations.includes(m.name)
    );

    if (pendingMigrations.length === 0) {
      logger.info('✓ Database is up to date, no migrations needed');
      return;
    }

    logger.info(`${pendingMigrations.length} migrations to execute`);

    // Execute pending migrations
    for (const migration of pendingMigrations) {
      await executeMigration(migration);
    }

    logger.info('✅ All migrations completed successfully');
  } catch (error) {
    logger.error('❌ Migration failed', error);
    throw error;
  } finally {
    await closeConnections();
  }
}

// Run migrations if called directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('\n✅ Database migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Database migration failed:', error);
      process.exit(1);
    });
}

export { runMigrations };
