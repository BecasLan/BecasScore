import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * SocialGraphAnalyzer
 *
 * Analyzes social relationships across the server by combining:
 * - Voice activity (who talks with whom)
 * - Reaction patterns (who reacts to whom)
 * - Message interactions (existing Phase 4 data)
 * - Conflict history
 *
 * Provides:
 * - Friend group detection (clusters)
 * - Conflict identification
 * - Relationship strength scoring
 * - Social network visualization data
 */

export interface SocialNode {
  userId: string;
  username?: string;
  cluster?: number;
  centrality: number;  // How connected/influential
  relationships: number;  // Number of connections
}

export interface SocialEdge {
  userId1: string;
  userId2: string;
  strength: number;  // -5 to 5 (negative = conflict, positive = friendship)
  type: 'friend' | 'neutral' | 'conflict';
  sources: {
    voice?: number;  // Voice sessions together
    reactions?: number;  // Reactions exchanged
    messages?: number;  // Messages exchanged
    conflicts?: number;  // Conflicts recorded
  };
}

export interface FriendGroup {
  clusterId: number;
  members: string[];
  cohesion: number;  // 0-1 (how tightly connected)
  size: number;
}

export interface SocialGraphData {
  nodes: SocialNode[];
  edges: SocialEdge[];
  clusters: FriendGroup[];
  stats: {
    totalUsers: number;
    totalRelationships: number;
    avgConnectionsPerUser: number;
    friendships: number;
    conflicts: number;
    isolatedUsers: number;
  };
}

export class SocialGraphAnalyzer {
  constructor(private db: Pool) {}

  /**
   * Analyze social graph for server
   */
  async analyzeSocialGraph(serverId: string): Promise<SocialGraphData> {
    try {
      logger.info(`Analyzing social graph for server ${serverId}...`);

      // Get all relationships
      const edges = await this.buildEdges(serverId);
      const nodes = await this.buildNodes(serverId, edges);
      const clusters = await this.detectClusters(nodes, edges);
      const stats = this.calculateStats(nodes, edges);

      return {
        nodes,
        edges,
        clusters,
        stats
      };
    } catch (error) {
      logger.error('Error analyzing social graph:', error);
      throw error;
    }
  }

  /**
   * Build edges (relationships) between users
   */
  private async buildEdges(serverId: string): Promise<SocialEdge[]> {
    const edges = new Map<string, SocialEdge>();

    // 1. Voice relationships
    const voiceQuery = `
      SELECT
        vp.user_id as user1,
        vp.participant_id as user2,
        COUNT(*) as sessions_together,
        SUM(vp.overlap_duration) as total_time
      FROM voice_participants vp
      WHERE vp.server_id = $1
      GROUP BY vp.user_id, vp.participant_id
      HAVING COUNT(*) >= 3
    `;

    const voiceResult = await this.db.query(voiceQuery, [serverId]);

    for (const row of voiceResult.rows) {
      const key = this.getEdgeKey(row.user1, row.user2);
      const sessionsCount = parseInt(row.sessions_together);
      const totalTime = parseInt(row.total_time) || 0;

      // Voice strength: more sessions + more time = stronger
      const voiceStrength = Math.min((sessionsCount * 0.1) + (totalTime / 3600 * 0.5), 2.0);

      if (!edges.has(key)) {
        edges.set(key, this.createEdge(row.user1, row.user2));
      }

      const edge = edges.get(key)!;
      edge.strength += voiceStrength;
      edge.sources.voice = sessionsCount;
    }

    // 2. Reaction relationships
    const reactionQuery = `
      SELECT
        user_id_1,
        user_id_2,
        (reactions_1_to_2 + reactions_2_to_1) as total_reactions,
        relationship_strength
      FROM reaction_relationship_signals
      WHERE server_id = $1
      AND (reactions_1_to_2 + reactions_2_to_1) >= 5
    `;

    const reactionResult = await this.db.query(reactionQuery, [serverId]);

    for (const row of reactionResult.rows) {
      const key = this.getEdgeKey(row.user_id_1, row.user_id_2);
      const reactionStrength = parseFloat(row.relationship_strength);
      const totalReactions = parseInt(row.total_reactions);

      if (!edges.has(key)) {
        edges.set(key, this.createEdge(row.user_id_1, row.user_id_2));
      }

      const edge = edges.get(key)!;
      edge.strength += reactionStrength;
      edge.sources.reactions = totalReactions;
    }

    // 3. Message interactions (from Phase 4 user_relationships)
    const messageQuery = `
      SELECT
        user_id_1,
        user_id_2,
        relationship_score,
        interaction_count
      FROM user_relationships
      WHERE server_id = $1
      AND interaction_count >= 10
    `;

    const messageResult = await this.db.query(messageQuery, [serverId]);

    for (const row of messageResult.rows) {
      const key = this.getEdgeKey(row.user_id_1, row.user_id_2);
      const messageStrength = parseFloat(row.relationship_score) * 2.0;  // Scale up
      const messageCount = parseInt(row.interaction_count);

      if (!edges.has(key)) {
        edges.set(key, this.createEdge(row.user_id_1, row.user_id_2));
      }

      const edge = edges.get(key)!;
      edge.strength += messageStrength;
      edge.sources.messages = messageCount;
    }

    // 4. Conflict history
    const conflictQuery = `
      SELECT
        user_id_1,
        user_id_2,
        COUNT(*) as conflict_count
      FROM conflicts
      WHERE server_id = $1
      GROUP BY user_id_1, user_id_2
    `;

    const conflictResult = await this.db.query(conflictQuery, [serverId]);

    for (const row of conflictResult.rows) {
      const key = this.getEdgeKey(row.user_id_1, row.user_id_2);
      const conflictCount = parseInt(row.conflict_count);
      const conflictPenalty = conflictCount * -1.5;  // Each conflict reduces strength

      if (!edges.has(key)) {
        edges.set(key, this.createEdge(row.user_id_1, row.user_id_2));
      }

      const edge = edges.get(key)!;
      edge.strength += conflictPenalty;
      edge.sources.conflicts = conflictCount;
    }

    // Classify edge types
    for (const edge of edges.values()) {
      if (edge.strength >= 2.0) {
        edge.type = 'friend';
      } else if (edge.strength <= -1.0) {
        edge.type = 'conflict';
      } else {
        edge.type = 'neutral';
      }
    }

    return Array.from(edges.values());
  }

  /**
   * Build nodes (users) with centrality scores
   */
  private async buildNodes(serverId: string, edges: SocialEdge[]): Promise<SocialNode[]> {
    // Get all unique users
    const userIds = new Set<string>();
    const userConnections = new Map<string, number>();
    const userStrengthSum = new Map<string, number>();

    for (const edge of edges) {
      userIds.add(edge.userId1);
      userIds.add(edge.userId2);

      // Count connections
      userConnections.set(edge.userId1, (userConnections.get(edge.userId1) || 0) + 1);
      userConnections.set(edge.userId2, (userConnections.get(edge.userId2) || 0) + 1);

      // Sum strengths
      userStrengthSum.set(edge.userId1, (userStrengthSum.get(edge.userId1) || 0) + Math.abs(edge.strength));
      userStrengthSum.set(edge.userId2, (userStrengthSum.get(edge.userId2) || 0) + Math.abs(edge.strength));
    }

    // Calculate centrality (how connected/influential)
    const maxConnections = Math.max(...Array.from(userConnections.values()), 1);
    const maxStrength = Math.max(...Array.from(userStrengthSum.values()), 1);

    const nodes: SocialNode[] = [];

    for (const userId of userIds) {
      const connections = userConnections.get(userId) || 0;
      const strengthSum = userStrengthSum.get(userId) || 0;

      // Centrality: combination of connection count and strength
      const connectionScore = connections / maxConnections;
      const strengthScore = strengthSum / maxStrength;
      const centrality = (connectionScore + strengthScore) / 2;

      nodes.push({
        userId,
        centrality,
        relationships: connections
      });
    }

    // Sort by centrality
    nodes.sort((a, b) => b.centrality - a.centrality);

    return nodes;
  }

  /**
   * Detect friend groups (clusters) using community detection
   */
  private async detectClusters(nodes: SocialNode[], edges: SocialEdge[]): Promise<FriendGroup[]> {
    // Simple community detection: connected components + modularity
    const clusters = new Map<number, Set<string>>();
    const userCluster = new Map<string, number>();
    let nextClusterId = 0;

    // Build adjacency list (only positive relationships)
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (edge.strength > 0) {  // Only consider positive relationships
        if (!adjacency.has(edge.userId1)) adjacency.set(edge.userId1, new Set());
        if (!adjacency.has(edge.userId2)) adjacency.set(edge.userId2, new Set());
        adjacency.get(edge.userId1)!.add(edge.userId2);
        adjacency.get(edge.userId2)!.add(edge.userId1);
      }
    }

    // DFS to find connected components
    const visited = new Set<string>();

    for (const node of nodes) {
      if (visited.has(node.userId)) continue;

      const clusterId = nextClusterId++;
      const clusterMembers = new Set<string>();

      const dfs = (userId: string) => {
        if (visited.has(userId)) return;
        visited.add(userId);
        clusterMembers.add(userId);
        userCluster.set(userId, clusterId);

        const neighbors = adjacency.get(userId) || new Set();
        for (const neighbor of neighbors) {
          dfs(neighbor);
        }
      };

      dfs(node.userId);
      clusters.set(clusterId, clusterMembers);
    }

    // Assign cluster IDs to nodes
    for (const node of nodes) {
      node.cluster = userCluster.get(node.userId);
    }

    // Calculate cluster cohesion
    const friendGroups: FriendGroup[] = [];

    for (const [clusterId, members] of clusters.entries()) {
      if (members.size < 2) continue;  // Skip single-user clusters

      // Calculate cohesion (average edge strength within cluster)
      let internalEdges = 0;
      let strengthSum = 0;

      for (const edge of edges) {
        if (members.has(edge.userId1) && members.has(edge.userId2)) {
          internalEdges++;
          strengthSum += Math.max(edge.strength, 0);
        }
      }

      const maxPossibleEdges = (members.size * (members.size - 1)) / 2;
      const density = maxPossibleEdges > 0 ? internalEdges / maxPossibleEdges : 0;
      const avgStrength = internalEdges > 0 ? strengthSum / internalEdges : 0;
      const cohesion = (density + Math.min(avgStrength / 5, 1)) / 2;  // 0-1

      friendGroups.push({
        clusterId,
        members: Array.from(members),
        cohesion,
        size: members.size
      });
    }

    // Sort by size (largest first)
    friendGroups.sort((a, b) => b.size - a.size);

    return friendGroups;
  }

  /**
   * Calculate graph statistics
   */
  private calculateStats(nodes: SocialNode[], edges: SocialEdge[]): {
    totalUsers: number;
    totalRelationships: number;
    avgConnectionsPerUser: number;
    friendships: number;
    conflicts: number;
    isolatedUsers: number;
  } {
    const totalUsers = nodes.length;
    const totalRelationships = edges.length;
    const friendships = edges.filter(e => e.type === 'friend').length;
    const conflicts = edges.filter(e => e.type === 'conflict').length;
    const isolatedUsers = nodes.filter(n => n.relationships === 0).length;
    const avgConnectionsPerUser = totalUsers > 0
      ? nodes.reduce((sum, n) => sum + n.relationships, 0) / totalUsers
      : 0;

    return {
      totalUsers,
      totalRelationships,
      avgConnectionsPerUser,
      friendships,
      conflicts,
      isolatedUsers
    };
  }

  /**
   * Get visualization data for Command Center
   */
  async getVisualizationData(serverId: string): Promise<{
    nodes: Array<{ id: string; label: string; group: number; value: number }>;
    edges: Array<{ from: string; to: string; value: number; color: string }>;
  }> {
    try {
      const graphData = await this.analyzeSocialGraph(serverId);

      const nodes = graphData.nodes.map(node => ({
        id: node.userId,
        label: node.username || node.userId.substring(0, 8),
        group: node.cluster || 0,
        value: Math.floor(node.centrality * 100)
      }));

      const edges = graphData.edges.map(edge => ({
        from: edge.userId1,
        to: edge.userId2,
        value: Math.abs(edge.strength),
        color: edge.type === 'friend' ? '#00ff00' : edge.type === 'conflict' ? '#ff0000' : '#999999'
      }));

      return { nodes, edges };
    } catch (error) {
      logger.error('Error getting visualization data:', error);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Get friend groups for server
   */
  async getFriendGroups(serverId: string, minSize: number = 2): Promise<FriendGroup[]> {
    try {
      const graphData = await this.analyzeSocialGraph(serverId);
      return graphData.clusters.filter(cluster => cluster.size >= minSize);
    } catch (error) {
      logger.error('Error getting friend groups:', error);
      return [];
    }
  }

  /**
   * Get most influential users (highest centrality)
   */
  async getInfluentialUsers(serverId: string, limit: number = 10): Promise<SocialNode[]> {
    try {
      const graphData = await this.analyzeSocialGraph(serverId);
      return graphData.nodes
        .filter(node => node.centrality > 0)
        .slice(0, limit);
    } catch (error) {
      logger.error('Error getting influential users:', error);
      return [];
    }
  }

  /**
   * Get conflict pairs
   */
  async getConflictPairs(serverId: string): Promise<Array<{
    userId1: string;
    userId2: string;
    conflictStrength: number;
    sources: any;
  }>> {
    try {
      const graphData = await this.analyzeSocialGraph(serverId);
      return graphData.edges
        .filter(edge => edge.type === 'conflict')
        .map(edge => ({
          userId1: edge.userId1,
          userId2: edge.userId2,
          conflictStrength: Math.abs(edge.strength),
          sources: edge.sources
        }))
        .sort((a, b) => b.conflictStrength - a.conflictStrength);
    } catch (error) {
      logger.error('Error getting conflict pairs:', error);
      return [];
    }
  }

  /**
   * Get user's social circle (direct connections)
   */
  async getUserSocialCircle(serverId: string, userId: string): Promise<{
    friends: Array<{ userId: string; strength: number }>;
    conflicts: Array<{ userId: string; strength: number }>;
    neutral: Array<{ userId: string; strength: number }>;
  }> {
    try {
      const graphData = await this.analyzeSocialGraph(serverId);

      const friends: Array<{ userId: string; strength: number }> = [];
      const conflicts: Array<{ userId: string; strength: number }> = [];
      const neutral: Array<{ userId: string; strength: number }> = [];

      for (const edge of graphData.edges) {
        let otherUserId: string | null = null;

        if (edge.userId1 === userId) {
          otherUserId = edge.userId2;
        } else if (edge.userId2 === userId) {
          otherUserId = edge.userId1;
        }

        if (!otherUserId) continue;

        const connection = {
          userId: otherUserId,
          strength: edge.strength
        };

        if (edge.type === 'friend') {
          friends.push(connection);
        } else if (edge.type === 'conflict') {
          conflicts.push(connection);
        } else {
          neutral.push(connection);
        }
      }

      // Sort by strength
      friends.sort((a, b) => b.strength - a.strength);
      conflicts.sort((a, b) => a.strength - b.strength);  // Most negative first
      neutral.sort((a, b) => b.strength - a.strength);

      return { friends, conflicts, neutral };
    } catch (error) {
      logger.error('Error getting user social circle:', error);
      return { friends: [], conflicts: [], neutral: [] };
    }
  }

  /**
   * Helper: Create edge key (consistent ordering)
   */
  private getEdgeKey(userId1: string, userId2: string): string {
    return userId1 < userId2 ? `${userId1}-${userId2}` : `${userId2}-${userId1}`;
  }

  /**
   * Helper: Create empty edge
   */
  private createEdge(userId1: string, userId2: string): SocialEdge {
    const [user1, user2] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
    return {
      userId1: user1,
      userId2: user2,
      strength: 0,
      type: 'neutral',
      sources: {}
    };
  }
}

/**
 * Example usage:
 *
 * const socialGraph = new SocialGraphAnalyzer(db);
 *
 * // Analyze full social graph
 * const graph = await socialGraph.analyzeSocialGraph(serverId);
 * console.log(`${graph.stats.totalUsers} users, ${graph.stats.friendships} friendships, ${graph.stats.conflicts} conflicts`);
 *
 * // Get friend groups
 * const groups = await socialGraph.getFriendGroups(serverId);
 * console.log('Friend groups:', groups);
 *
 * // Get influential users
 * const influential = await socialGraph.getInfluentialUsers(serverId);
 * console.log('Most influential:', influential);
 *
 * // Get user's social circle
 * const circle = await socialGraph.getUserSocialCircle(serverId, userId);
 * console.log(`${circle.friends.length} friends, ${circle.conflicts.length} conflicts`);
 *
 * // Get visualization data for Command Center
 * const viz = await socialGraph.getVisualizationData(serverId);
 * // Use with D3.js, vis.js, or similar graph library
 */
