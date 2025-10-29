/**
 * Vercel Serverless Function: Get User Trust Score
 * GET /api/user/[userId]
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get userId from URL path or query
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get user sicil summary from database
    const { data: sicilSummary, error } = await supabase
      .from('user_sicil_summary')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found (ok)
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    // If no sicil record, return default safe user
    if (!sicilSummary) {
      return res.json({
        userId,
        username: userId.substring(0, 8) + '...',
        discriminator: '0000',
        avatar: `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`,
        trustScore: 100,
        riskLevel: 'safe',
        flags: [],
        joinedAt: new Date().toISOString(),
        violations: {
          total: 0,
          bans: 0,
          kicks: 0,
          timeouts: 0,
          warnings: 0
        }
      });
    }

    // Calculate trust score
    const totalViolations =
      sicilSummary.total_warnings +
      sicilSummary.total_timeouts +
      sicilSummary.total_kicks +
      sicilSummary.total_bans;

    const trustScore = Math.max(0, 100 - (totalViolations * 10));

    // Determine risk level
    let riskLevel = 'safe';
    if (trustScore < 30) riskLevel = 'dangerous';
    else if (trustScore < 50) riskLevel = 'risky';
    else if (trustScore < 70) riskLevel = 'watch';

    // Build flags
    const flags = [];
    if (sicilSummary.scam_violations > 0) flags.push('scammer');
    if (sicilSummary.phishing_violations > 0) flags.push('phishing');
    if (sicilSummary.toxicity_violations > 3) flags.push('toxic');
    if (sicilSummary.spam_violations > 5) flags.push('spammer');
    if (sicilSummary.harassment_violations > 0) flags.push('harasser');
    if (sicilSummary.total_bans > 0) flags.push('banned');

    res.json({
      userId: sicilSummary.user_id,
      username: sicilSummary.user_id.substring(0, 8) + '...',
      discriminator: '0000',
      avatar: `https://cdn.discordapp.com/embed/avatars/${parseInt(sicilSummary.user_id) % 5}.png`,
      trustScore,
      riskLevel,
      flags,
      joinedAt: sicilSummary.created_at,
      lastViolation: sicilSummary.last_violation_at,
      cleanStreak: sicilSummary.clean_streak_days,
      violations: {
        total: totalViolations,
        bans: sicilSummary.total_bans,
        kicks: sicilSummary.total_kicks,
        timeouts: sicilSummary.total_timeouts,
        warnings: sicilSummary.total_warnings,
        scam: sicilSummary.scam_violations,
        phishing: sicilSummary.phishing_violations,
        toxicity: sicilSummary.toxicity_violations,
        spam: sicilSummary.spam_violations,
        harassment: sicilSummary.harassment_violations
      }
    });
  } catch (error: any) {
    console.error('Error in user API:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
