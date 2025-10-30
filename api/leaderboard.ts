import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const type = (req.query.type as string) || 'all'; // 'all', 'violations', 'trusted', 'risky'

    // Build WHERE clause based on type
    let whereClause = '';
    if (type === 'violations') {
      // Only show users with violations
      whereClause = `WHERE s.last_violation_at IS NOT NULL
        AND (s.total_warnings > 0 OR s.total_timeouts > 0 OR s.total_kicks > 0 OR s.total_bans > 0)`;
    } else if (type === 'risky') {
      // Only show risky/dangerous users
      whereClause = `WHERE s.risk_category IN ('risky', 'dangerous')`;
    } else if (type === 'trusted') {
      // Only show trusted users (high trust score, low violations)
      whereClause = `WHERE u.global_trust_score >= 80`;
    } else {
      // Show all users (default)
      whereClause = `WHERE u.user_id IS NOT NULL`;
    }

    // Determine sorting based on type
    let orderByClause = '';
    if (type === 'violations' || type === 'risky') {
      orderByClause = 'ORDER BY total_violations DESC, s.last_violation_at DESC';
    } else if (type === 'trusted') {
      orderByClause = 'ORDER BY u.global_trust_score DESC';
    } else {
      // Default: sort by trust score (lowest first to see problematic users)
      orderByClause = 'ORDER BY u.global_trust_score ASC, total_violations DESC';
    }

    // Query joins users with sicil_summary to get violation data
    const query = `
      SELECT
        u.user_id as "userId",
        u.username,
        u.avatar_url as avatar,
        u.global_trust_score as "trustScore",
        u.global_risk_score as "riskScore",
        s.last_violation_at as "lastViolation",
        COALESCE(s.total_warnings, 0) as total_warnings,
        COALESCE(s.total_timeouts, 0) as total_timeouts,
        COALESCE(s.total_kicks, 0) as total_kicks,
        COALESCE(s.total_bans, 0) as total_bans,
        COALESCE(s.toxicity_violations, 0) as toxicity_violations,
        COALESCE(s.spam_violations, 0) as spam_violations,
        COALESCE(s.harassment_violations, 0) as harassment_violations,
        COALESCE(s.scam_violations, 0) as scam_violations,
        COALESCE(s.phishing_violations, 0) as phishing_violations,
        COALESCE(s.risk_category, 'safe') as risk_category,
        COALESCE(s.total_warnings, 0) + COALESCE(s.total_timeouts, 0) + COALESCE(s.total_kicks, 0) + COALESCE(s.total_bans, 0) as total_violations,
        ROW_NUMBER() OVER (${orderByClause.replace('ORDER BY ', '')}) as rank
      FROM users u
      LEFT JOIN user_sicil_summary s ON u.user_id = s.user_id
      ${whereClause}
      ${orderByClause}
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM users u
      LEFT JOIN user_sicil_summary s ON u.user_id = s.user_id
      ${whereClause}
    `;

    const [leaderboardResult, countResult] = await Promise.all([
      pool.query(query, [limit, offset]),
      pool.query(countQuery)
    ]);

    // Build violations array from violation counts
    const leaderboard = leaderboardResult.rows.map((user: any) => {
      const violations: string[] = [];

      if (user.total_warnings > 0) violations.push(`${user.total_warnings} warnings`);
      if (user.total_timeouts > 0) violations.push(`${user.total_timeouts} timeouts`);
      if (user.total_kicks > 0) violations.push(`${user.total_kicks} kicks`);
      if (user.total_bans > 0) violations.push(`${user.total_bans} bans`);

      // Add category violations
      const categories: string[] = [];
      if (user.toxicity_violations > 0) categories.push('toxicity');
      if (user.spam_violations > 0) categories.push('spam');
      if (user.harassment_violations > 0) categories.push('harassment');
      if (user.scam_violations > 0) categories.push('scam');
      if (user.phishing_violations > 0) categories.push('phishing');

      return {
        userId: user.userId,
        username: user.username,
        avatar: user.avatar,
        trustScore: user.trustScore || 100,
        riskScore: user.riskScore || 0,
        lastViolation: user.lastViolation,
        rank: parseInt(user.rank),
        violations: violations,
        categories: categories,
        riskCategory: user.risk_category,
        totalViolations: parseInt(user.total_violations || 0)
      };
    });

    return res.status(200).json({
      leaderboard,
      total: parseInt(countResult.rows[0]?.total || '0'),
      page,
      limit
    });
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}
