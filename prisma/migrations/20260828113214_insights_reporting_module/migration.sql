-- AlterTable
ALTER TABLE "MonitorTask" ADD COLUMN "stoppedAt" DATETIME;

-- CreateTable
CREATE TABLE "BreachIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationSec" INTEGER,
    "maxValue" REAL,
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "startEventId" TEXT NOT NULL,
    "endEventId" TEXT,
    CONSTRAINT "BreachIncident_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "TaskMetric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyMetricStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "monitoredSeconds" INTEGER NOT NULL DEFAULT 0,
    "healthySeconds" INTEGER NOT NULL DEFAULT 0,
    "breachedSeconds" INTEGER NOT NULL DEFAULT 0,
    "breachCount" INTEGER NOT NULL DEFAULT 0,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DailyMetricStat_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "TaskMetric" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportingCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "lastProcessedEventId" TEXT,
    "lastProcessedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PeakPeriodConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "daysOfWeek" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PeakPeriodConfig_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BreachIncident_metricId_startedAt_idx" ON "BreachIncident"("metricId", "startedAt");

-- CreateIndex
CREATE INDEX "BreachIncident_metricId_endedAt_idx" ON "BreachIncident"("metricId", "endedAt");

-- CreateIndex
CREATE INDEX "DailyMetricStat_date_idx" ON "DailyMetricStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetricStat_metricId_date_key" ON "DailyMetricStat"("metricId", "date");

-- CreateIndex
CREATE INDEX "PeakPeriodConfig_siteId_idx" ON "PeakPeriodConfig"("siteId");
