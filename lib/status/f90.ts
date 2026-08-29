import { stableRatio } from "./hash";

/**
 * Whether a site is currently flagged on the "F90" metric (an external
 * operational KPI). Mock implementation — deterministic per site, isolated
 * behind this one function so a real F90 API can replace the body later
 * without touching the Site model or any UI component.
 */
export async function getF90Status(siteId: string): Promise<boolean> {
  return stableRatio(`f90:${siteId}`) < 0.25;
}

export async function getF90StatusForSites(siteIds: string[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(siteIds.map(async (id) => [id, await getF90Status(id)] as const));
  return Object.fromEntries(entries);
}
