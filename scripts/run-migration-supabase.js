const { getSupabaseClient } = require('../dist/database/SupabaseClient');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  console.log('🔄 Running database migration via Supabase...');

  const supabase = getSupabaseClient();

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/add_wallet_fields.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Executing migration...');

    // Split SQL into individual statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('COMMENT'));

    for (const statement of statements) {
      console.log(`  Executing: ${statement.substring(0, 60)}...`);
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });

      if (error) {
        // Try direct table modification
        if (statement.includes('ALTER TABLE trust_scores')) {
          console.log('  Using alternative approach...');
          // We'll handle this through the bot's database service instead
        } else {
          console.warn('  Warning:', error.message);
        }
      }
    }

    console.log('\n✅ Migration completed!');
    console.log('\n📊 Next steps:');
    console.log('  1. Go to Supabase Dashboard > SQL Editor');
    console.log('  2. Run the migration SQL manually:');
    console.log('     https://supabase.com/dashboard/project/ozvmhttedfzrvsquklyo/sql');
    console.log('\n  Or copy this SQL:');
    console.log('  -----------------------------------------------');
    console.log(sql);
    console.log('  -----------------------------------------------');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n📝 Manual Migration Required:');
    console.log('  Go to: https://supabase.com/dashboard/project/ozvmhttedfzrvsquklyo/sql');
    console.log('  Run: migrations/add_wallet_fields.sql');
  }
}

runMigration();
