import { stableRatio } from "./hash";

/**
 * Whether a site is currently in "Red Zone" (an operational escalation
 * state). Mock implementation — deterministic per site, isolated behind
 * this one function so a real Red Zone API can replace the body later
 * without touching the Site model or any UI component.
 */
export async function getRedZoneStatus(siteId: string): Promise<boolean> {
  return stableRatio(`redzone:${siteId}`) < 0.15;
}

export async function getRedZoneStatusForSites(siteIds: string[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(siteIds.map(async (id) => [id, await getRedZoneStatus(id)] as const));
  return Object.fromEntries(entries);
}
