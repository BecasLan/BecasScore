// scripts/setup-db.js - Database initialization script

require('dotenv').config(); // Load environment variables
const { db, initDb } = require('../trustkit/db');

async function setupDatabase() {
  try {
    console.log('Initializing database...');
    await initDb();
    console.log('Database setup complete!');
    process.exit(0);
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

setupDatabase();