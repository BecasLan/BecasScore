/**
 * BECASFLOW TOOLS - CENTRALIZED EXPORTS
 *
 * Exports all BecasFlow tools and provides registration helper.
 */

// Moderation tools
export { banTool } from './moderation/ban.tool';
export { timeoutTool } from './moderation/timeout.tool';
export { kickTool } from './moderation/kick.tool';
export { warnTool } from './moderation/warn.tool';
export { deleteMessagesTool } from './moderation/delete_messages.tool';
export { setSlowmodeTool } from './moderation/set_slowmode.tool';
export { lockChannelTool } from './moderation/lock_channel.tool';
export { unlockChannelTool } from './moderation/unlock_channel.tool';
export { addRoleTool } from './moderation/add_role.tool';
export { removeRoleTool } from './moderation/remove_role.tool';
export { createChannelTool } from './moderation/create_channel.tool';
export { policyManagementTool } from './PolicyManagementTool';

// Trust tools
export { checkTrustTool } from './trust/check_trust.tool';
export { updateTrustTool } from './trust/update_trust.tool';
export { trustReportTool } from './trust/trust_report.tool';

// Analytics tools
export { serverStatsTool } from './analytics/server_stats.tool';
export { userActivityTool } from './analytics/user_activity.tool';
export { moderationHistoryTool } from './analytics/moderation_history.tool';

// Data manipulation tools
export { dataFilterTool } from './data/data_filter.tool';
export { dataSortTool } from './data/data_sort.tool';
export { dataSliceTool } from './data/data_slice.tool';
export { dataGroupTool } from './data/data_group.tool';
export { dataAggregateTool } from './data/data_aggregate.tool';
export { dataTransformTool } from './data/data_transform.tool';
export { dataJoinTool } from './data/data_join.tool';

// Intelligence tools
export { intentRouterTool } from './intelligence/intent_router.tool';

// Import types
import { BecasTool } from '../types/BecasFlow.types';
import { BecasToolRegistry } from '../registry/BecasToolRegistry';

// Import all tools
import { banTool } from './moderation/ban.tool';
import { timeoutTool } from './moderation/timeout.tool';
import { kickTool } from './moderation/kick.tool';
import { warnTool } from './moderation/warn.tool';
import { deleteMessagesTool } from './moderation/delete_messages.tool';
import { setSlowmodeTool } from './moderation/set_slowmode.tool';
import { lockChannelTool } from './moderation/lock_channel.tool';
import { unlockChannelTool } from './moderation/unlock_channel.tool';
import { addRoleTool } from './moderation/add_role.tool';
import { removeRoleTool } from './moderation/remove_role.tool';
import { createChannelTool } from './moderation/create_channel.tool';
import { policyManagementTool } from './PolicyManagementTool';
import { checkTrustTool } from './trust/check_trust.tool';
import { updateTrustTool } from './trust/update_trust.tool';
import { trustReportTool } from './trust/trust_report.tool';
import { serverStatsTool } from './analytics/server_stats.tool';
import { userActivityTool } from './analytics/user_activity.tool';
import { moderationHistoryTool } from './analytics/moderation_history.tool';
import { dataFilterTool } from './data/data_filter.tool';
import { dataSortTool } from './data/data_sort.tool';
import { dataSliceTool } from './data/data_slice.tool';
import { dataGroupTool } from './data/data_group.tool';
import { dataAggregateTool } from './data/data_aggregate.tool';
import { dataTransformTool } from './data/data_transform.tool';
import { dataJoinTool } from './data/data_join.tool';
import { intentRouterTool } from './intelligence/intent_router.tool';

/**
 * All available tools
 */
export const ALL_TOOLS: BecasTool[] = [
  // Intelligence (runs first)
  intentRouterTool,

  // Moderation
  banTool,
  timeoutTool,
  kickTool,
  warnTool,
  deleteMessagesTool,
  setSlowmodeTool,
  lockChannelTool,
  unlockChannelTool,
  addRoleTool,
  removeRoleTool,
  createChannelTool,
  policyManagementTool,

  // Trust
  checkTrustTool,
  updateTrustTool,
  trustReportTool,

  // Analytics
  serverStatsTool,
  userActivityTool,
  moderationHistoryTool,

  // Data manipulation
  dataFilterTool,
  dataSortTool,
  dataSliceTool,
  dataGroupTool,
  dataAggregateTool,
  dataTransformTool,
  dataJoinTool,
];

/**
 * Register all tools to registry
 */
export function registerAllTools(registry?: BecasToolRegistry): void {
  const reg = registry || BecasToolRegistry.getInstance();

  ALL_TOOLS.forEach((tool) => {
    reg.register(tool);
  });

  console.log(`✅ Registered ${ALL_TOOLS.length} BecasFlow tools`);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: BecasTool['category']): BecasTool[] {
  return ALL_TOOLS.filter((tool) => tool.category === category);
}

/**
 * Get tool by name
 */
export function getToolByName(name: string): BecasTool | undefined {
  return ALL_TOOLS.find((tool) => tool.name === name);
}
