// lib/utils/stage-mapper.ts - Simplified stage mapping
import { logger } from "./logger";

export type SimProStage = string;
export type MondayStage = "Discovery" | "Proposal Sent" | "Won" | "Lost";

/**
 * Simplified stage mapping - only what we actually need
 * Default: Everything goes to "Discovery"
 * Exception: "Quote: Sent" → "Proposal Sent"
 */
export function mapSimProToMondayStage(simproStage: string): MondayStage {
  const normalizedStage = simproStage.toLowerCase().trim();

  // The only mapping we care about
  if (normalizedStage.includes("sent")) {
    logger.debug(`[Stage Mapper] "${simproStage}" → "Proposal Sent"`);
    return "Proposal Sent";
  }

  // Everything else defaults to Discovery
  logger.debug(`[Stage Mapper] "${simproStage}" → "Discovery" (default)`);
  return "Discovery";
}

/**
 * Get the Monday stage index for API calls
 * These indexes correspond to your Monday board's status column
 */
export function getMondayStageIndex(stage: MondayStage): number {
  const stageIndexMap: Record<MondayStage, number> = {
    Discovery: 0,
    "Proposal Sent": 1,
    Won: 2,
    Lost: 3,
  };

  return stageIndexMap[stage] ?? 0; // Default to Discovery
}

/**
 * Check if a stage change is significant enough to log/notify
 */
export function isSignificantStageChange(
  oldStage: MondayStage,
  newStage: MondayStage
): boolean {
  // Only log when moving to/from Proposal Sent or Won/Lost
  const significantStages: MondayStage[] = ["Proposal Sent", "Won", "Lost"];

  return (
    significantStages.includes(oldStage) || significantStages.includes(newStage)
  );
}
