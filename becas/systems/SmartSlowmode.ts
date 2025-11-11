// SmartSlowmode.ts - Dynamic rate limiting based on activity

import { TextChannel, Guild } from 'discord.js';

export interface SlowmodeState {
  channelId: string;
  currentDelay: number; // seconds
  messagesPerMinute: number;
  spamScore: number; // 0-1
  autoEnabled: boolean;
  lastUpdated: Date;
}

export class SmartSlowmode {
  private states: Map<string, SlowmodeState> = new Map();
  private messageCounts: Map<string, number[]> = new Map(); // channelId -> timestamps

  /**
   * Track message and adjust slowmode dynamically
   */
  async processMessage(channelId: string, channel: TextChannel): Promise<void> {
    const now = Date.now();
    const timestamps = this.messageCounts.get(channelId) || [];

    // Add current timestamp
    timestamps.push(now);

    // Keep only last minute
    const oneMinuteAgo = now - 60000;
    const recentMessages = timestamps.filter(t => t > oneMinuteAgo);
    this.messageCounts.set(channelId, recentMessages);

    // Calculate messages per minute
    const messagesPerMinute = recentMessages.length;

    // Get or create state
    let state = this.states.get(channelId);
    if (!state) {
      state = {
        channelId,
        currentDelay: 0,
        messagesPerMinute: 0,
        spamScore: 0,
        autoEnabled: false,
        lastUpdated: new Date(),
      };
      this.states.set(channelId, state);
    }

    state.messagesPerMinute = messagesPerMinute;
    state.lastUpdated = new Date();

    // Calculate spam score (0-1)
    // 30+ messages/min = high spam
    state.spamScore = Math.min(1, messagesPerMinute / 30);

    // Determine appropriate slowmode delay
    const targetDelay = this.calculateSlowmodeDelay(state.spamScore);

    // Only adjust if significantly different
    if (Math.abs(targetDelay - state.currentDelay) >= 3) {
      try {
        await channel.setRateLimitPerUser(targetDelay);
        state.currentDelay = targetDelay;
        state.autoEnabled = targetDelay > 0;

        if (targetDelay > 0) {
          console.log(`🐌 Auto-slowmode enabled: ${targetDelay}s (${messagesPerMinute} msg/min)`);
        } else {
          console.log(`✓ Auto-slowmode disabled (activity normalized)`);
        }
      } catch (error) {
        console.error('Failed to set slowmode:', error);
      }
    }
  }

  /**
   * Calculate appropriate slowmode delay based on spam score
   */
  private calculateSlowmodeDelay(spamScore: number): number {
    if (spamScore < 0.3) return 0; // No slowmode
    if (spamScore < 0.5) return 3; // Light: 3 seconds
    if (spamScore < 0.7) return 10; // Medium: 10 seconds
    if (spamScore < 0.9) return 30; // Heavy: 30 seconds
    return 60; // Critical: 1 minute
  }

  /**
   * Get current state
   */
  getState(channelId: string): SlowmodeState | undefined {
    return this.states.get(channelId);
  }

  /**
   * Disable slowmode manually
   */
  async disableSlowmode(channel: TextChannel): Promise<void> {
    try {
      await channel.setRateLimitPerUser(0);
      const state = this.states.get(channel.id);
      if (state) {
        state.currentDelay = 0;
        state.autoEnabled = false;
      }
      console.log(`✓ Slowmode disabled for ${channel.name}`);
    } catch (error) {
      console.error('Failed to disable slowmode:', error);
    }
  }
}
