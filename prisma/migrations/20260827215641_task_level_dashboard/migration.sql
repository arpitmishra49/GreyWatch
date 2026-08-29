/*
  Warnings:

  - You are about to drop the column `dashboardUid` on the `Site` table. All the data in the column will be lost.
  - Added the required column `dashboardUid` to the `MonitorTask` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MonitorTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "dashboardUid" TEXT NOT NULL,
    "pollIntervalMin" INTEGER NOT NULL,
    "cooldownMin" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "notifyCreator" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "nextCheckAt" DATETIME NOT NULL,
    CONSTRAINT "MonitorTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MonitorTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MonitorTask" ("cooldownMin", "createdById", "durationMin", "expiresAt", "id", "nextCheckAt", "notifyCreator", "pollIntervalMin", "siteId", "startedAt", "status") SELECT "cooldownMin", "createdById", "durationMin", "expiresAt", "id", "nextCheckAt", "notifyCreator", "pollIntervalMin", "siteId", "startedAt", "status" FROM "MonitorTask";
DROP TABLE "MonitorTask";
ALTER TABLE "new_MonitorTask" RENAME TO "MonitorTask";
CREATE INDEX "MonitorTask_status_nextCheckAt_idx" ON "MonitorTask"("status", "nextCheckAt");
CREATE TABLE "new_Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "grafanaBaseUrl" TEXT NOT NULL,
    "grafanaApiToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Site" ("createdAt", "grafanaApiToken", "grafanaBaseUrl", "id", "isActive", "name", "slug", "updatedAt") SELECT "createdAt", "grafanaApiToken", "grafanaBaseUrl", "id", "isActive", "name", "slug", "updatedAt" FROM "Site";
DROP TABLE "Site";
ALTER TABLE "new_Site" RENAME TO "Site";
CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");
CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
