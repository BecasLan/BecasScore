/**
 * DISCORD OAUTH AUTHENTICATION SERVICE
 *
 * Handles Discord OAuth2 flow for Command Center authentication
 */

import axios from 'axios';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/environment';
import { createLogger } from './Logger';

const logger = createLogger('AuthService');

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_OAUTH_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  email?: string;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
}

export interface AuthSession {
  userId: string;
  username: string;
  avatar: string | null;
  guilds: DiscordGuild[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class AuthService {
  /**
   * Generate Discord OAuth URL
   */
  static getAuthorizationURL(): string {
    const params = new URLSearchParams({
      client_id: ENV.DISCORD_CLIENT_ID,
      redirect_uri: ENV.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds',
    });

    return `${DISCORD_OAUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  static async exchangeCode(code: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    try {
      const response = await axios.post(
        DISCORD_TOKEN_URL,
        new URLSearchParams({
          client_id: ENV.DISCORD_CLIENT_ID,
          client_secret: ENV.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: ENV.DISCORD_REDIRECT_URI,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Failed to exchange code for token', error.response?.data || error);
      throw new Error('Failed to authenticate with Discord');
    }
  }

  /**
   * Get user information from Discord
   */
  static async getUser(accessToken: string): Promise<DiscordUser> {
    try {
      const response = await axios.get(`${DISCORD_API_BASE}/users/@me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error('Failed to fetch user info', error.response?.data || error);
      throw new Error('Failed to fetch user information');
    }
  }

  /**
   * Get user's guilds from Discord
   */
  static async getUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
    try {
      const response = await axios.get(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error('Failed to fetch user guilds', error.response?.data || error);
      throw new Error('Failed to fetch user guilds');
    }
  }

  /**
   * Filter guilds where user has admin permissions
   */
  static filterAdminGuilds(guilds: DiscordGuild[]): DiscordGuild[] {
    const ADMINISTRATOR = 0x8;
    const MANAGE_GUILD = 0x20;

    return guilds.filter(guild => {
      if (guild.owner) return true;

      const permissions = parseInt(guild.permissions);
      return (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
             (permissions & MANAGE_GUILD) === MANAGE_GUILD;
    });
  }

  /**
   * Create JWT session token
   */
  static createSessionToken(session: AuthSession): string {
    return jwt.sign(
      {
        userId: session.userId,
        username: session.username,
        avatar: session.avatar,
        guilds: session.guilds,
        expiresAt: session.expiresAt,
      },
      ENV.SESSION_SECRET,
      {
        expiresIn: '7d',
      }
    );
  }

  /**
   * Verify and decode JWT session token
   */
  static verifySessionToken(token: string): AuthSession | null {
    try {
      const decoded = jwt.verify(token, ENV.SESSION_SECRET) as any;

      // Check if token expired
      if (decoded.expiresAt && Date.now() > decoded.expiresAt) {
        return null;
      }

      return {
        userId: decoded.userId,
        username: decoded.username,
        avatar: decoded.avatar,
        guilds: decoded.guilds || [],
        accessToken: '',
        refreshToken: '',
        expiresAt: decoded.expiresAt,
      };
    } catch (error) {
      logger.error('Failed to verify session token', error);
      return null;
    }
  }

  /**
   * Complete OAuth flow (exchange code, get user, get guilds)
   */
  static async completeOAuthFlow(code: string): Promise<AuthSession> {
    try {
      // 1. Exchange code for tokens
      const tokenData = await this.exchangeCode(code);

      // 2. Get user info
      const user = await this.getUser(tokenData.access_token);

      // 3. Get user's guilds
      const allGuilds = await this.getUserGuilds(tokenData.access_token);

      // 4. Filter admin guilds
      const adminGuilds = this.filterAdminGuilds(allGuilds);

      // 5. Create session
      const session: AuthSession = {
        userId: user.id,
        username: `${user.username}#${user.discriminator}`,
        avatar: user.avatar,
        guilds: adminGuilds,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
      };

      logger.info(`User authenticated: ${session.username} (${adminGuilds.length} admin guilds)`);

      return session;
    } catch (error) {
      logger.error('OAuth flow failed', error);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> {
    try {
      const response = await axios.post(
        DISCORD_TOKEN_URL,
        new URLSearchParams({
          client_id: ENV.DISCORD_CLIENT_ID,
          client_secret: ENV.DISCORD_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Failed to refresh token', error.response?.data || error);
      throw new Error('Failed to refresh access token');
    }
  }
}
