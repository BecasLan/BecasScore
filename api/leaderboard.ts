import type { VercelRequest, VercelResponse } from '@vercel/node';

// Supabase REST API configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;
    const type = (req.query.type as string) || 'all'; // 'all', 'violations', 'trusted', 'risky'

    // Fetch users from Supabase
    const usersUrl = `${SUPABASE_URL}/rest/v1/users?select=*&limit=${limit}&offset=${offset}`;
    const usersRes = await fetch(usersUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!usersRes.ok) {
      throw new Error(`Failed to fetch users: ${usersRes.statusText}`);
    }

    const users = await usersRes.json();

    // Fetch sicil summary for each user
    const userIds = users.map((u: any) => u.id).join(',');
    const sicilUrl = `${SUPABASE_URL}/rest/v1/user_sicil_summary?user_id=in.(${userIds})&select=*`;
    const sicilRes = await fetch(sicilUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    const sicilData = sicilRes.ok ? await sicilRes.json() : [];

    // Create a map of sicil data by user_id
    const sicilMap = new Map();
    sicilData.forEach((s: any) => {
      sicilMap.set(s.user_id, s);
    });

    // Build leaderboard with combined data
    let leaderboard = users.map((user: any) => {
      const sicil = sicilMap.get(user.id) || {};

      const totalWarnings = sicil.total_warnings || 0;
      const totalTimeouts = sicil.total_timeouts || 0;
      const totalKicks = sicil.total_kicks || 0;
      const totalBans = sicil.total_bans || 0;
      const totalViolations = totalWarnings + totalTimeouts + totalKicks + totalBans;

      const violations: string[] = [];
      if (totalWarnings > 0) violations.push(`${totalWarnings} warnings`);
      if (totalTimeouts > 0) violations.push(`${totalTimeouts} timeouts`);
      if (totalKicks > 0) violations.push(`${totalKicks} kicks`);
      if (totalBans > 0) violations.push(`${totalBans} bans`);

      const categories: string[] = [];
      if (sicil.toxicity_violations > 0) categories.push('toxicity');
      if (sicil.spam_violations > 0) categories.push('spam');
      if (sicil.harassment_violations > 0) categories.push('harassment');
      if (sicil.scam_violations > 0) categories.push('scam');
      if (sicil.phishing_violations > 0) categories.push('phishing');

      return {
        userId: user.id,
        username: user.username,
        avatar: user.avatar_url,
        trustScore: user.global_trust_score || 100,
        riskScore: user.global_risk_score || 0,
        lastViolation: sicil.last_violation_at,
        violations: violations,
        categories: categories,
        riskCategory: sicil.risk_category || 'safe',
        totalViolations: totalViolations
      };
    });

    // Filter based on type
    if (type === 'violations') {
      leaderboard = leaderboard.filter((u: any) => u.totalViolations > 0);
    } else if (type === 'risky') {
      leaderboard = leaderboard.filter((u: any) =>
        u.riskCategory === 'risky' || u.riskCategory === 'dangerous'
      );
    } else if (type === 'trusted') {
      leaderboard = leaderboard.filter((u: any) => u.trustScore >= 80);
    }

    // Sort based on type
    if (type === 'violations' || type === 'risky') {
      leaderboard.sort((a: any, b: any) => b.totalViolations - a.totalViolations);
    } else if (type === 'trusted') {
      leaderboard.sort((a: any, b: any) => b.trustScore - a.trustScore);
    } else {
      // Default: sort by trust score (lowest first to see problematic users)
      leaderboard.sort((a: any, b: any) => {
        if (a.trustScore === b.trustScore) {
          return b.totalViolations - a.totalViolations;
        }
        return a.trustScore - b.trustScore;
      });
    }

    // Add rank
    leaderboard = leaderboard.map((user: any, index: number) => ({
      ...user,
      rank: index + 1 + offset
    }));

    // Get total count
    const countUrl = `${SUPABASE_URL}/rest/v1/users?select=count`;
    const countRes = await fetch(countUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact'
      }
    });

    let total = users.length;
    if (countRes.ok) {
      const contentRange = countRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) total = parseInt(match[1]);
      }
    }

    return res.status(200).json({
      leaderboard,
      total,
      page,
      limit
    });
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return res.status(500).json({
      error: 'Failed to fetch leaderboard',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
