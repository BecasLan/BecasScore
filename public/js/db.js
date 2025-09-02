// trustkit/db/index.js - Database connection and methods

const knex = require('knex');
const config = require('./config');
const { createSchema } = require('./schema');

// Use environment to determine which config to use
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env].postgres; // or .sqlite for development

// Initialize database connection
const db = knex(dbConfig);

// Initialize schema
async function initDb() {
  try {
    await createSchema(db);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
}

// User methods
const Users = {
  async create(userData) {
    return db('users').insert(userData).returning('*');
  },
  
  async findById(id) {
    return db('users').where({ id }).first();
  },
  
  async update(id, data) {
    return db('users').where({ id }).update(data).returning('*');
  },
  
  async linkWallet(userId, walletAddress) {
    return db('users').where({ id: userId }).update({ wallet_address: walletAddress });
  }
};

// Trust Score methods
const TrustScores = {
  async get(userId, serverId = null) {
    const query = db('trust_scores').where({ user_id: userId });
    if (serverId) {
      query.where({ server_id: serverId });
    }
    return query.first();
  },
  
  async update(userId, serverId, scoreChange, reason = '') {
    // First, get current score or create if not exists
    let record = await this.get(userId, serverId);
    
    if (!record) {
      // Create new score record with default 100
      await db('trust_scores').insert({
        user_id: userId,
        server_id: serverId,
        score: 100
      });
      record = { score: 100 };
    }
    
    // Calculate new score (clamped between 0-100)
    const newScore = Math.max(0, Math.min(100, record.score + scoreChange));
    
    // Update score in database
    await db('trust_scores')
      .where({ user_id: userId, server_id: serverId })
      .update({ 
        score: newScore,
        last_updated: db.fn.now()
      });
    
    // If score change is negative, record violation
    if (scoreChange < 0) {
      await Violations.create({
        user_id: userId,
        server_id: serverId,
        type: reason,
        severity: Math.abs(scoreChange) > 10 ? 'high' : (Math.abs(scoreChange) > 5 ? 'medium' : 'low'),
        score_impact: scoreChange,
        details: `Score adjusted by ${scoreChange} points. Reason: ${reason}`
      });
    }
    
    return { 
      previousScore: record.score,
      newScore,
      change: scoreChange
    };
  },
  
  async getLeaderboard(limit = 10, lowestFirst = true) {
    const query = db('trust_scores')
      .join('users', 'trust_scores.user_id', 'users.id')
      .select(
        'trust_scores.user_id',
        'users.username',
        'users.discriminator',
        'users.avatar',
        'trust_scores.score'
      )
      .orderBy('trust_scores.score', lowestFirst ? 'asc' : 'desc')
      .limit(limit);
    
    return query;
  }
};

// Violations methods
const Violations = {
  async create(violationData) {
    return db('violations').insert(violationData).returning('*');
  },
  
  async getByUser(userId, limit = 20) {
    return db('violations')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(limit);
  },
  
  async recordOnChain(violationId, txHash) {
    return db('violations')
      .where({ id: violationId })
      .update({ 
        tx_hash: txHash,
        cross_server: true
      });
  }
};

// Server methods
const Servers = {
  async create(serverData) {
    return db('servers').insert(serverData).returning('*');
  },
  
  async findById(id) {
    return db('servers').where({ id }).first();
  },
  
  async update(id, data) {
    return db('servers').where({ id }).update(data);
  },
  
  async updateSettings(id, settings) {
    const server = await this.findById(id);
    const updatedSettings = { ...server.settings, ...settings };
    
    return db('servers')
      .where({ id })
      .update({ settings: JSON.stringify(updatedSettings) });
  }
};

// User Summaries methods
const Summaries = {
  async get(userId, serverId = null) {
    const query = db('user_summaries').where({ user_id: userId });
    if (serverId) {
      query.where({ server_id: serverId });
    } else {
      query.whereNull('server_id');
    }
    return query.first();
  },
  
  async update(userId, serverId, summaryData) {
    const existing = await this.get(userId, serverId);
    
    if (existing) {
      return db('user_summaries')
        .where({ user_id: userId, server_id: serverId || null })
        .update({
          summary: summaryData.summary,
          risk_flags: JSON.stringify(summaryData.risk_flags || []),
          advice: summaryData.advice,
          updated_at: db.fn.now()
        });
    } else {
      return db('user_summaries').insert({
        user_id: userId,
        server_id: serverId,
        summary: summaryData.summary,
        risk_flags: JSON.stringify(summaryData.risk_flags || []),
        advice: summaryData.advice
      });
    }
  }
};

// Reports methods
const Reports = {
  async create(reportData) {
    return db('reports').insert(reportData).returning('*');
  },
  
  async validate(reportId, validated = true) {
    return db('reports')
      .where({ id: reportId })
      .update({ validated });
  },
  
  async recordReward(reportId, amount, txHash) {
    return db('reports')
      .where({ id: reportId })
      .update({
        reward_amount: amount,
        reward_tx: txHash
      });
  },
  
  async getUserStats(userId) {
    const stats = await db('reports')
      .where({ reporter_id: userId })
      .count('* as total')
      .sum('reward_amount as totalRewards')
      .first();
    
    const validatedCount = await db('reports')
      .where({ reporter_id: userId, validated: true })
      .count('* as count')
      .first();
    
    return {
      totalReports: parseInt(stats.total),
      validatedReports: parseInt(validatedCount.count),
      totalRewards: parseInt(stats.totalRewards) || 0
    };
  }
};

module.exports = {
  db,
  initDb,
  Users,
  TrustScores,
  Violations,
  Servers,
  Summaries,
  Reports
};