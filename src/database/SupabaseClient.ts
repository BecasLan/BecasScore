/**
 * SUPABASE CLIENT
 *
 * REST API based database client for Supabase
 * Works without direct PostgreSQL connection (firewall-friendly)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../services/Logger';

const logger = createLogger('SupabaseClient');

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get Supabase client (singleton)
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment');
    }

    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    logger.info('✅ Supabase REST API client initialized');
  }

  return supabaseInstance;
}

/**
 * Test Supabase connection
 */
export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();

    // Try to query a table
    const { error } = await supabase
      .from('user_sicil_summary')
      .select('id')
      .limit(1);

    if (error) {
      logger.error('Supabase connection test failed:', error);
      return false;
    }

    logger.info('✅ Supabase connection test successful');
    return true;
  } catch (error) {
    logger.error('Supabase connection test error:', error);
    return false;
  }
}
