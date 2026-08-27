import { PrismaClient } from "@prisma/client";

// Shared singleton so the Next.js dev server's hot-reload doesn't spin up a
// new PrismaClient (and a new SQLite connection) on every module reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
