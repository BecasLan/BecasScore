// trustkit/db/schema.js - Database schema definition

async function createSchema(knex) {
  // Users table
  if (!await knex.schema.hasTable('users')) {
    await knex.schema.createTable('users', table => {
      table.string('id').primary(); // Discord user ID
      table.string('username');
      table.string('discriminator');
      table.string('avatar');
      table.string('wallet_address').nullable(); // Optional wallet connection
      table.timestamps(true, true);
    });
  }

  // Servers table
  if (!await knex.schema.hasTable('servers')) {
    await knex.schema.createTable('servers', table => {
      table.string('id').primary(); // Discord server ID
      table.string('name');
      table.string('owner_id');
      table.json('settings'); // Server-specific settings as JSON
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    });
  }

  // Trust Scores table
  if (!await knex.schema.hasTable('trust_scores')) {
    await knex.schema.createTable('trust_scores', table => {
      table.increments('id').primary();
      table.string('user_id');
      table.string('server_id');
      table.integer('score').defaultTo(100);
      table.timestamp('last_updated').defaultTo(knex.fn.now());
      table.unique(['user_id', 'server_id']);
      table.foreign('user_id').references('users.id');
      table.foreign('server_id').references('servers.id');
    });
  }

  // Violations table
  if (!await knex.schema.hasTable('violations')) {
    await knex.schema.createTable('violations', table => {
      table.increments('id').primary();
      table.string('user_id');
      table.string('server_id');
      table.string('type'); // scam, spam, hate, etc.
      table.integer('severity');
      table.integer('score_impact');
      table.text('details');
      table.boolean('cross_server').defaultTo(false);
      table.string('tx_hash').nullable(); // Blockchain transaction hash if recorded
      table.timestamps(true, true);
      table.foreign('user_id').references('users.id');
      table.foreign('server_id').references('servers.id');
    });
  }

  // User Summaries table
  if (!await knex.schema.hasTable('user_summaries')) {
    await knex.schema.createTable('user_summaries', table => {
      table.increments('id').primary();
      table.string('user_id');
      table.string('server_id').nullable(); // Null for global summary
      table.text('summary');
      table.json('risk_flags').nullable();
      table.text('advice').nullable();
      table.timestamps(true, true);
      table.foreign('user_id').references('users.id');
      table.foreign('server_id').references('servers.id');
    });
  }
  
  // Reports table (for reward tracking)
  if (!await knex.schema.hasTable('reports')) {
    await knex.schema.createTable('reports', table => {
      table.increments('id').primary();
      table.string('reporter_id'); // User who reported
      table.string('reported_id'); // User who was reported
      table.string('server_id');
      table.boolean('validated').defaultTo(false);
      table.integer('reward_amount').nullable();
      table.string('reward_tx').nullable(); // Transaction ID for reward
      table.timestamps(true, true);
      table.foreign('reporter_id').references('users.id');
      table.foreign('reported_id').references('users.id');
      table.foreign('server_id').references('servers.id');
    });
  }
}

module.exports = { createSchema };