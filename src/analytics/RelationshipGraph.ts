import { createLogger } from '../services/Logger';
import { EventTracker, TrackedEvent } from './EventTracker';

const logger = createLogger('RelationshipGraph');

/**
 * RELATIONSHIP GRAPH - Kim kime ne yaptı takip sistemi
 *
 * Tracks user-to-user relationships:
 * - Yeşil: Arkadaş / Friendly
 * - Kırmızı: Düşman / Hostile
 * - Mavi: Yeni tanıştı / New
 * - Turuncu: Nötr / Neutral
 */

export type RelationshipType = 'friend' | 'hostile' | 'new' | 'neutral';

export interface UserRelationship {
  from: string;        // User A
  to: string;          // User B
  type: RelationshipType;
  strength: number;    // 0-1 scale

  // History
  lastInteraction: number;
  interactionCount: number;

  // Events
  positiveEvents: number;  // mesaj, emoji, help
  negativeEvents: number;  // çatışma, ban, warn

  // Metadata
  firstMet: number;
  history: {
    timestamp: number;
    event: string;
    oldType?: RelationshipType;
    newType?: RelationshipType;
  }[];
}

export interface RelationshipChange {
  timestamp: number;
  from: string;
  to: string;
  oldType: RelationshipType;
  newType: RelationshipType;
  reason: string;
}

export class RelationshipGraph {
  private relationships: Map<string, Map<string, UserRelationship>> = new Map();
  private changes: RelationshipChange[] = [];

  constructor() {
    logger.info('🕸️  RelationshipGraph initialized');
  }

  /**
   * Get or create relationship between two users
   */
  private getRelationship(guildId: string, fromId: string, toId: string): UserRelationship {
    const key = `${guildId}:${fromId}:${toId}`;

    if (!this.relationships.has(guildId)) {
      this.relationships.set(guildId, new Map());
    }

    const guildRelationships = this.relationships.get(guildId)!;

    if (!guildRelationships.has(key)) {
      guildRelationships.set(key, {
        from: fromId,
        to: toId,
        type: 'new',
        strength: 0.5,
        lastInteraction: Date.now(),
        interactionCount: 0,
        positiveEvents: 0,
        negativeEvents: 0,
        firstMet: Date.now(),
        history: [],
      });
    }

    return guildRelationships.get(key)!;
  }

  /**
   * Process an event and update relationships
   */
  processEvent(guildId: string, event: TrackedEvent): void {
    if (!event.actorId || !event.targetId) return;

    const relationship = this.getRelationship(guildId, event.actorId, event.targetId);
    const oldType = relationship.type;

    // Update interaction count
    relationship.interactionCount++;
    relationship.lastInteraction = Date.now();

    // Update based on event type
    const isPositive = this.isPositiveEvent(event);
    const isNegative = this.isNegativeEvent(event);

    if (isPositive) {
      relationship.positiveEvents++;
      relationship.strength = Math.min(1, relationship.strength + 0.1);
    }

    if (isNegative) {
      relationship.negativeEvents++;
      relationship.strength = Math.max(0, relationship.strength - 0.2);
    }

    // Determine new relationship type
    const newType = this.calculateRelationshipType(relationship);

    // Track change if type changed
    if (oldType !== newType) {
      const change: RelationshipChange = {
        timestamp: Date.now(),
        from: event.actorId,
        to: event.targetId,
        oldType,
        newType,
        reason: event.type,
      };

      this.changes.push(change);

      relationship.history.push({
        timestamp: Date.now(),
        event: event.type,
        oldType,
        newType,
      });

      logger.info(`Relationship changed: ${event.actorId} → ${event.targetId}: ${oldType} → ${newType}`);
    }

    relationship.type = newType;
  }

  /**
   * Calculate relationship type based on interactions
   */
  private calculateRelationshipType(rel: UserRelationship): RelationshipType {
    const total = rel.positiveEvents + rel.negativeEvents;

    // New relationship (< 3 interactions)
    if (total < 3) {
      return 'new';
    }

    // Calculate ratio
    const positiveRatio = total > 0 ? rel.positiveEvents / total : 0.5;

    // Friend: mostly positive (>70%)
    if (positiveRatio > 0.7 && rel.strength > 0.6) {
      return 'friend';
    }

    // Hostile: mostly negative (<30%)
    if (positiveRatio < 0.3 && rel.strength < 0.4) {
      return 'hostile';
    }

    // Neutral: everything else
    return 'neutral';
  }

  /**
   * Check if event is positive
   */
  private isPositiveEvent(event: TrackedEvent): boolean {
    const positiveTypes = ['message', 'reaction', 'mention', 'friendship'];
    return positiveTypes.includes(event.type) || event.sentiment === 'positive';
  }

  /**
   * Check if event is negative
   */
  private isNegativeEvent(event: TrackedEvent): boolean {
    const negativeTypes = ['ban', 'kick', 'timeout', 'warn', 'conflict'];
    return negativeTypes.includes(event.type) || event.sentiment === 'negative';
  }

  /**
   * Get all relationships for a guild
   */
  getAllRelationships(guildId: string): UserRelationship[] {
    const guildRelationships = this.relationships.get(guildId);
    if (!guildRelationships) return [];

    return Array.from(guildRelationships.values());
  }

  /**
   * Get relationships for a specific user
   */
  getUserRelationships(guildId: string, userId: string): {
    outgoing: UserRelationship[];  // Who they interact with
    incoming: UserRelationship[];  // Who interacts with them
  } {
    const all = this.getAllRelationships(guildId);

    return {
      outgoing: all.filter(r => r.from === userId),
      incoming: all.filter(r => r.to === userId),
    };
  }

  /**
   * Get relationship between two users
   */
  getRelationshipBetween(guildId: string, user1: string, user2: string): {
    forward: UserRelationship | null;
    reverse: UserRelationship | null;
  } {
    const all = this.getAllRelationships(guildId);

    return {
      forward: all.find(r => r.from === user1 && r.to === user2) || null,
      reverse: all.find(r => r.from === user2 && r.to === user1) || null,
    };
  }

  /**
   * Get recent relationship changes (for timeline / "savaş grafiği")
   */
  getRecentChanges(guildId?: string, limit: number = 50): RelationshipChange[] {
    let changes = [...this.changes];

    // Filter by guild if provided
    if (guildId) {
      changes = changes.filter(c => {
        const rel = this.getRelationship(guildId, c.from, c.to);
        return rel !== null;
      });
    }

    // Sort by timestamp (newest first)
    changes.sort((a, b) => b.timestamp - a.timestamp);

    return changes.slice(0, limit);
  }

  /**
   * Get conflict pairs (hostile relationships)
   */
  getConflicts(guildId: string): UserRelationship[] {
    return this.getAllRelationships(guildId)
      .filter(r => r.type === 'hostile');
  }

  /**
   * Get friendship pairs
   */
  getFriendships(guildId: string): UserRelationship[] {
    return this.getAllRelationships(guildId)
      .filter(r => r.type === 'friend');
  }

  /**
   * Get graph data for visualization
   */
  getGraphData(guildId: string): {
    nodes: { id: string; label: string }[];
    edges: {
      from: string;
      to: string;
      type: RelationshipType;
      strength: number;
      color: string;
    }[];
  } {
    const relationships = this.getAllRelationships(guildId);

    // Get unique users
    const userIds = new Set<string>();
    relationships.forEach(r => {
      userIds.add(r.from);
      userIds.add(r.to);
    });

    const nodes = Array.from(userIds).map(id => ({
      id,
      label: `User ${id.substring(0, 8)}`,
    }));

    const edges = relationships.map(r => ({
      from: r.from,
      to: r.to,
      type: r.type,
      strength: r.strength,
      color: this.getRelationshipColor(r.type),
    }));

    return { nodes, edges };
  }

  /**
   * Get color for relationship type
   */
  private getRelationshipColor(type: RelationshipType): string {
    const colors = {
      friend: '#00FF00',      // Yeşil (Green)
      hostile: '#FF0000',     // Kırmızı (Red)
      new: '#0000FF',         // Mavi (Blue)
      neutral: '#FFA500',     // Turuncu (Orange)
    };
    return colors[type];
  }

  /**
   * Get relationship stats for dashboard
   */
  getStats(guildId: string): {
    totalRelationships: number;
    friendships: number;
    conflicts: number;
    newRelationships: number;
    recentChanges: number;
  } {
    const all = this.getAllRelationships(guildId);
    const recent = this.getRecentChanges(guildId, 100);

    // Count recent changes (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentChanges = recent.filter(c => c.timestamp >= oneDayAgo).length;

    return {
      totalRelationships: all.length,
      friendships: all.filter(r => r.type === 'friend').length,
      conflicts: all.filter(r => r.type === 'hostile').length,
      newRelationships: all.filter(r => r.type === 'new').length,
      recentChanges,
    };
  }
}
