const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    host: 'aws-1-eu-north-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.ozvmhttedfzrvsquklyo',
    password: 'becasbecas_local_123456',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    const client = await pool.connect();

    console.log('📖 Reading migration file...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'src', 'database', 'migrations', '021_fix_remaining_varchar.sql'),
      'utf8'
    );

    console.log('🚀 Running migration 021...');
    await client.query(migrationSQL);

    console.log('✅ Migration 021 completed successfully!');

    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
