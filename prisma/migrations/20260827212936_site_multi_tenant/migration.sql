/*
  Warnings:

  - Added the required column `grafanaBaseUrl` to the `Site` table without a default value. This is not possible if the table is not empty.
  - Added the required column `slug` to the `Site` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Site` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dashboardUid" TEXT NOT NULL,
    "grafanaBaseUrl" TEXT NOT NULL,
    "grafanaApiToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Site" ("dashboardUid", "id", "name") SELECT "dashboardUid", "id", "name" FROM "Site";
DROP TABLE "Site";
ALTER TABLE "new_Site" RENAME TO "Site";
CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");
CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
