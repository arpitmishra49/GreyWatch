/*
  Warnings:

  - You are about to drop the column `lastAlertAt` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `lastStatus` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `operator` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `panelId` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `panelTitle` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `threadTs` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `threshold` on the `MonitorTask` table. All the data in the column will be lost.
  - You are about to drop the column `taskId` on the `TaskEvent` table. All the data in the column will be lost.
  - Added the required column `metricId` to the `TaskEvent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "TaskMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "panelId" INTEGER NOT NULL,
    "panelTitle" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "lastStatus" TEXT,
    "lastAlertAt" DATETIME,
    "threadTs" TEXT,
    "creatorThreadTs" TEXT,
    CONSTRAINT "TaskMetric_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MonitorTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MonitorTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
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
CREATE TABLE "new_TaskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricId" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "capturedValue" REAL,
    "breached" BOOLEAN,
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TaskEvent_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "TaskMetric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TaskEvent" ("alerted", "breached", "capturedValue", "checkedAt", "errorMessage", "id", "success") SELECT "alerted", "breached", "capturedValue", "checkedAt", "errorMessage", "id", "success" FROM "TaskEvent";
DROP TABLE "TaskEvent";
ALTER TABLE "new_TaskEvent" RENAME TO "TaskEvent";
CREATE INDEX "TaskEvent_metricId_checkedAt_idx" ON "TaskEvent"("metricId", "checkedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TaskMetric_taskId_idx" ON "TaskMetric"("taskId");
