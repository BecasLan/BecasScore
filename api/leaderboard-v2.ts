import type { VercelRequest, VercelResponse } from '@vercel/node';

// Supabase REST API configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const limit = parseInt(req.query.limit as string) || 100;
    const walletFilter = req.query.wallet as string; // Optional: filter by specific wallet

    // Build query URL - fetch from users table
    let queryUrl = `${SUPABASE_URL}/rest/v1/users?select=id,username,global_trust_score,wallet_address,basename,updated_at&order=global_trust_score.desc&limit=${limit}`;

    if (walletFilter) {
      queryUrl += `&wallet_address=eq.${walletFilter.toLowerCase()}`;
    }

    // Fetch users from Supabase
    const usersRes = await fetch(queryUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!usersRes.ok) {
      throw new Error(`Failed to fetch users: ${usersRes.statusText}`);
    }

    const users = await usersRes.json();

    // Build leaderboard
    const leaderboard = users.map((user: any, index: number) => ({
      rank: index + 1,
      discordId: user.id,
      username: user.username || 'Unknown',
      trustScore: user.global_trust_score || 100,
      walletAddress: user.wallet_address || null,
      basename: user.basename || null,
      lastUpdated: user.updated_at,
      // Add badge based on score
      badge: user.global_trust_score >= 90 ? '🏆' : user.global_trust_score >= 80 ? '⭐' : user.global_trust_score >= 70 ? '✓' : user.global_trust_score >= 50 ? '⚠️' : '❌'
    }));

    // Get total count
    const countUrl = `${SUPABASE_URL}/rest/v1/trust_scores?select=count`;
    const countRes = await fetch(countUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact'
      }
    });

    let total = scores.length;
    if (countRes.ok) {
      const contentRange = countRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) total = parseInt(match[1]);
      }
    }

    return res.status(200).json({
      success: true,
      leaderboard,
      total,
      limit,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Leaderboard V2 API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch leaderboard',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
