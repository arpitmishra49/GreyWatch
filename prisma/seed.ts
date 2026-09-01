import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/passwords";
import { authEnv, grafanaEnv } from "../lib/env";
import { slugifySiteName } from "../lib/siteSlug";
import { INITIAL_SITE_NAMES } from "./siteSeedData";

const prisma = new PrismaClient();

async function seedSites() {
  const slugs = new Set<string>();
  for (const name of INITIAL_SITE_NAMES) {
    const slug = slugifySiteName(name);
    if (slugs.has(slug)) {
      throw new Error(`Slug collision for "${name}" -> "${slug}" — two distinct names produced the same slug.`);
    }
    slugs.add(slug);

    // Every site points at the sandbox Grafana + its one provisioned
    // dashboard for now. grafanaApiToken stays null (shares the env
    // token) until a real per-site credential exists.
    await prisma.site.upsert({
      where: { slug },
      update: { name, grafanaBaseUrl: grafanaEnv.GRAFANA_BASE_URL },
      create: { name, slug, grafanaBaseUrl: grafanaEnv.GRAFANA_BASE_URL },
    });
  }
  console.log(`Seeded ${INITIAL_SITE_NAMES.length} sites.`);
}

async function seedCacEngineer() {
  const passwordHash = await hashPassword(authEnv.CAC_ENGINEER_PASSWORD);
  await prisma.user.upsert({
    where: { username: authEnv.CAC_ENGINEER_USERNAME },
    update: { passwordHash },
    create: { username: authEnv.CAC_ENGINEER_USERNAME, passwordHash, role: "engineer" },
  });
  console.log(`Seeded shared account "${authEnv.CAC_ENGINEER_USERNAME}".`);
}

// Global default peak-period window for Insights reporting — 9am-6pm on
// weekdays. A site-specific PeakPeriodConfig row (siteId set) overrides
// this later without any code change; nothing today creates those, so this
// global row is the only one that needs seeding.
async function seedPeakPeriodDefault() {
  const existingGlobal = await prisma.peakPeriodConfig.findFirst({ where: { siteId: null } });
  if (existingGlobal) return;
  await prisma.peakPeriodConfig.create({
    data: { siteId: null, startHour: 9, endHour: 18, daysOfWeek: "1,2,3,4,5" },
  });
  console.log("Seeded global default peak period (9am-6pm, Mon-Fri).");
}

async function main() {
  await seedSites();
  await seedCacEngineer();
  await seedPeakPeriodDefault();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
