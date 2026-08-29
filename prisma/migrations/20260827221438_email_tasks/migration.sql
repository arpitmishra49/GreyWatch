-- CreateTable
CREATE TABLE "EmailTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "dashboardUid" TEXT NOT NULL,
    "intervalMin" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "nextSendAt" DATETIME NOT NULL,
    "lastSentAt" DATETIME,
    CONSTRAINT "EmailTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EmailTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailTaskMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailTaskId" TEXT NOT NULL,
    "panelId" INTEGER NOT NULL,
    "panelTitle" TEXT NOT NULL,
    CONSTRAINT "EmailTaskMetric_emailTaskId_fkey" FOREIGN KEY ("emailTaskId") REFERENCES "EmailTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailTaskId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    CONSTRAINT "EmailRecipient_emailTaskId_fkey" FOREIGN KEY ("emailTaskId") REFERENCES "EmailTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailSendEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailTaskId" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "recipientCount" INTEGER NOT NULL,
    CONSTRAINT "EmailSendEvent_emailTaskId_fkey" FOREIGN KEY ("emailTaskId") REFERENCES "EmailTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EmailTask_status_nextSendAt_idx" ON "EmailTask"("status", "nextSendAt");

-- CreateIndex
CREATE INDEX "EmailTaskMetric_emailTaskId_idx" ON "EmailTaskMetric"("emailTaskId");

-- CreateIndex
CREATE INDEX "EmailRecipient_emailTaskId_idx" ON "EmailRecipient"("emailTaskId");

-- CreateIndex
CREATE INDEX "EmailSendEvent_emailTaskId_sentAt_idx" ON "EmailSendEvent"("emailTaskId", "sentAt");
