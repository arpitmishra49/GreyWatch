import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.site.upsert({
    where: { name: "Site A" },
    update: { dashboardUid: "site-a" },
    create: { name: "Site A", dashboardUid: "site-a" },
  });
  console.log("Seeded Site table.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
