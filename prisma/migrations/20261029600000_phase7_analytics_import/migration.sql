-- AlterTable
ALTER TABLE "Lock" ADD COLUMN     "sectionSelectors" TEXT;

-- CreateTable
CREATE TABLE "LockStat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "lockId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "denied" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LockStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "rows" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LockStat_shopId_day_idx" ON "LockStat"("shopId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "LockStat_shopId_lockId_day_key" ON "LockStat"("shopId", "lockId", "day");

-- CreateIndex
CREATE INDEX "ImportJob_shopId_createdAt_idx" ON "ImportJob"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "LockStat" ADD CONSTRAINT "LockStat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

