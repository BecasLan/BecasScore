// trustkit/api/routes.js - API endpoints

const express = require('express');
const router = express.Router();
const { Users, TrustScores, Violations, Summaries, Reports } = require('../db');
const { authenticateToken } = require('./auth'); // You would need to implement this

// Middleware to verify API access
router.use(authenticateToken);

// Get user trust score
router.get('/users/:userId/score', async (req, res) => {
  try {
    const { userId } = req.params;
    const { serverId } = req.query;
    
    const score = await TrustScores.get(userId, serverId);
    if (!score) {
      return res.json({ 
        score: 100, // Default score
        lastUpdated: null
      });
    }
    
    res.json({
      score: score.score,
      lastUpdated: score.last_updated
    });
  } catch (error) {
    console.error('Error fetching user score:', error);
    res.status(500).json({ error: 'Failed to fetch user score' });
  }
});

// Get user violations
router.get('/users/:userId/violations', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    
    const violations = await Violations.getByUser(userId, parseInt(limit));
    res.json({ violations });
  } catch (error) {
    console.error('Error fetching violations:', error);
    res.status(500).json({ error: 'Failed to fetch violations' });
  }
});

// Get user summary
router.get('/users/:userId/summary', async (req, res) => {
  try {
    const { userId } = req.params;
    const { serverId } = req.query;
    
    const summary = await Summaries.get(userId, serverId);
    if (!summary) {
      return res.json({
        summary: null,
        riskFlags: [],
        advice: null
      });
    }
    
    res.json({
      summary: summary.summary,
      riskFlags: JSON.parse(summary.risk_flags || '[]'),
      advice: summary.advice
    });
  } catch (error) {
    console.error('Error fetching user summary:', error);
    res.status(500).json({ error: 'Failed to fetch user summary' });
  }
});

// Get leaderboard (lowest trust scores)
router.get('/leaderboard', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const leaderboard = await TrustScores.getLeaderboard(parseInt(limit), true);
    res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Submit a report
router.post('/reports', async (req, res) => {
  try {
    const { reporterId, reportedId, serverId, details } = req.body;
    
    if (!reporterId || !reportedId || !serverId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const report = await Reports.create({
      reporter_id: reporterId,
      reported_id: reportedId,
      server_id: serverId,
      details
    });
    
    res.status(201).json({ report });
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

module.exports = router;