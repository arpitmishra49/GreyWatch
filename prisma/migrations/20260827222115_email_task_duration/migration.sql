/*
  Warnings:

  - Added the required column `durationMin` to the `EmailTask` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmailTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "dashboardUid" TEXT NOT NULL,
    "intervalMin" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "nextSendAt" DATETIME NOT NULL,
    "lastSentAt" DATETIME,
    CONSTRAINT "EmailTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EmailTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EmailTask" ("createdById", "dashboardUid", "expiresAt", "id", "intervalMin", "lastSentAt", "nextSendAt", "siteId", "startedAt", "status") SELECT "createdById", "dashboardUid", "expiresAt", "id", "intervalMin", "lastSentAt", "nextSendAt", "siteId", "startedAt", "status" FROM "EmailTask";
DROP TABLE "EmailTask";
ALTER TABLE "new_EmailTask" RENAME TO "EmailTask";
CREATE INDEX "EmailTask_status_nextSendAt_idx" ON "EmailTask"("status", "nextSendAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
