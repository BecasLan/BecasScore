// trustkit/db/config.js - Database configuration

const config = {
  development: {
    // SQLite - Simple file-based database (good for development)
    sqlite: {
      client: 'sqlite3',
      connection: {
        filename: './data/becas.sqlite'
      },
      useNullAsDefault: true
    },
    
    // PostgreSQL - Robust database for production
    postgres: {
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'becas',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password'
      },
      pool: { min: 0, max: 10 }
    },
    
    // MongoDB - Document-based option
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/becas'
    }
  },
  
  production: {
    // Your production settings here
    postgres: {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      pool: { min: 0, max: 20 }
    }
  }
};

module.exports = config;