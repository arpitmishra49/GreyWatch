/*
  Warnings:

  - You are about to drop the column `notifyCreator` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `creatorThreadTs` on the `TaskMetric` table. All the data in the column will be lost.
  - You are about to drop the column `slackUserId` on the `User` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationRecipient_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MonitorTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipientAlertThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "threadTs" TEXT NOT NULL,
    CONSTRAINT "RecipientAlertThread_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "TaskMetric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecipientAlertThread_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NotificationRecipient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "nextCheckAt" DATETIME NOT NULL,
    CONSTRAINT "MonitorTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MonitorTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MonitorTask" ("cooldownMin", "createdById", "dashboardUid", "durationMin", "expiresAt", "id", "nextCheckAt", "pollIntervalMin", "siteId", "startedAt", "status") SELECT "cooldownMin", "createdById", "dashboardUid", "durationMin", "expiresAt", "id", "nextCheckAt", "pollIntervalMin", "siteId", "startedAt", "status" FROM "MonitorTask";
DROP TABLE "MonitorTask";
ALTER TABLE "new_MonitorTask" RENAME TO "MonitorTask";
CREATE INDEX "MonitorTask_status_nextCheckAt_idx" ON "MonitorTask"("status", "nextCheckAt");
CREATE TABLE "new_TaskMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "panelId" INTEGER NOT NULL,
    "panelTitle" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "lastStatus" TEXT,
    "lastAlertAt" DATETIME,
    "threadTs" TEXT,
    CONSTRAINT "TaskMetric_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MonitorTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TaskMetric" ("id", "lastAlertAt", "lastStatus", "operator", "panelId", "panelTitle", "taskId", "threadTs", "threshold") SELECT "id", "lastAlertAt", "lastStatus", "operator", "panelId", "panelTitle", "taskId", "threadTs", "threshold" FROM "TaskMetric";
DROP TABLE "TaskMetric";
ALTER TABLE "new_TaskMetric" RENAME TO "TaskMetric";
CREATE INDEX "TaskMetric_taskId_idx" ON "TaskMetric"("taskId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'engineer',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "id", "passwordHash", "role", "username") SELECT "createdAt", "id", "passwordHash", "role", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "NotificationRecipient_taskId_idx" ON "NotificationRecipient"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientAlertThread_metricId_recipientId_key" ON "RecipientAlertThread"("metricId", "recipientId");
