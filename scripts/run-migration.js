const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  console.log('🔄 Running database migration...');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/add_wallet_fields.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Executing migration...');
    await client.query(sql);

    console.log('✅ Migration completed successfully!');
    console.log('\n📊 Columns added:');
    console.log('  - wallet_address (TEXT, indexed, unique)');
    console.log('  - basename (TEXT, indexed, unique)');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
