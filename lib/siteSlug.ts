// Generates a stable, unique-ish machine identifier from a site's display
// name, without ever touching the display name itself (e.g. "GXO-A&F"
// stays exactly "GXO-A&F" in the UI; its slug is "gxo-a-and-f").
export function slugifySiteName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
