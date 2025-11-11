/**
 * Vercel Serverless Function: Get User Violations
 * GET /api/violations/[userId]
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

    // Get user actions from database
    const { data: userActions, error } = await supabase
      .from('user_actions')
      .select('*')
      .eq('user_id', userId)
      .eq('triggered_moderation', true)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    if (!userActions || userActions.length === 0) {
      return res.json({ violations: [] });
    }

    // Format violations
    const violations = userActions.map((action: any) => {
      // Determine violation tag
      let tag = 'violation';
      if (action.moderation_action) {
        const modAction = action.moderation_action.toLowerCase();
        if (modAction.includes('ban')) tag = 'ban';
        else if (modAction.includes('timeout') || modAction.includes('mute')) tag = 'timeout';
        else if (modAction.includes('kick')) tag = 'kick';
        else if (modAction.includes('warn')) tag = 'warning';
      }

      // Determine specific violation type
      if (action.scam_score > 0.7) tag = 'scam';
      else if (action.toxicity_score > 0.7) tag = 'toxicity';
      else if (action.spam_score > 0.7) tag = 'spam';

      // Build details text
      let detailsText = action.intent || 'Violation detected';
      if (action.content) {
        detailsText += ` | Message: "${action.content.substring(0, 100)}${action.content.length > 100 ? '...' : ''}"`;
      }
      if (action.toxicity_score > 0) {
        detailsText += ` | Toxicity: ${(action.toxicity_score * 100).toFixed(1)}%`;
      }
      if (action.scam_score > 0) {
        detailsText += ` | Scam Risk: ${(action.scam_score * 100).toFixed(1)}%`;
      }

      return {
        type: formatViolationType(tag),
        tag,
        date: action.timestamp,
        impact: action.moderation_action || 'Flagged',
        server: action.server_id,
        details: detailsText,
        structured: {
          message: action.content,
          channelId: action.channel_id,
          toxicity: action.toxicity_score,
          scam: action.scam_score,
          spam: action.spam_score,
          intent: action.intent,
          sentiment: action.sentiment,
          wasProvoked: action.was_provoked,
          emotionalState: action.emotional_state
        }
      };
    });

    res.json({ violations });
  } catch (error: any) {
    console.error('Error in violations API:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

function formatViolationType(tag: string): string {
  const types: Record<string, string> = {
    'ban': 'Banned',
    'kick': 'Kicked',
    'timeout': 'Timeout',
    'warning': 'Warning',
    'scam': 'Scam Detected',
    'phishing': 'Phishing Attempt',
    'toxicity': 'Toxic Behavior',
    'spam': 'Spam',
    'harassment': 'Harassment',
    'hate': 'Hate Speech',
    'insult': 'Insult'
  };
  return types[tag] || 'Violation';
}
