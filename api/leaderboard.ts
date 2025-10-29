/**
 * Vercel Serverless Function: Get Scammer Leaderboard
 * GET /api/leaderboard?limit=20&page=1
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
    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;

    // Get high-risk users from database
    const { data: sicilRecords, error, count } = await supabase
      .from('user_sicil_summary')
      .select('*', { count: 'exact' })
      .in('risk_category', ['risky', 'dangerous'])
      .order('total_warnings', { ascending: false })
      .order('total_timeouts', { ascending: false })
      .order('total_bans', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    if (!sicilRecords || sicilRecords.length === 0) {
      return res.json({
        total: 0,
        page,
        limit,
        leaderboard: []
      });
    }

    // Format leaderboard
    const leaderboard = sicilRecords.map((record: any, index: number) => {
      const violations = [];
      if (record.total_bans > 0) violations.push('ban');
      if (record.total_kicks > 0) violations.push('kick');
      if (record.total_timeouts > 0) violations.push('timeout');
      if (record.total_warnings > 0) violations.push('warning');
      if (record.scam_violations > 0) violations.push('scam');
      if (record.phishing_violations > 0) violations.push('phishing');
      if (record.toxicity_violations > 0) violations.push('toxicity');
      if (record.spam_violations > 0) violations.push('spam');
      if (record.harassment_violations > 0) violations.push('harassment');

      const totalViolations =
        record.total_warnings +
        record.total_timeouts +
        record.total_kicks +
        record.total_bans;

      // Calculate trust score (inverse of violations)
      const trustScore = Math.max(0, 100 - (totalViolations * 10));

      return {
        rank: offset + index + 1,
        userId: record.user_id,
        username: record.user_id.substring(0, 8) + '...',
        avatar: `https://cdn.discordapp.com/embed/avatars/${parseInt(record.user_id) % 5}.png`,
        trustScore,
        lastViolation: record.last_violation_at || new Date().toISOString(),
        violations,
        totalViolations,
        riskCategory: record.risk_category
      };
    });

    res.json({
      total: count || sicilRecords.length,
      page,
      limit,
      leaderboard
    });
  } catch (error: any) {
    console.error('Error in leaderboard API:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
