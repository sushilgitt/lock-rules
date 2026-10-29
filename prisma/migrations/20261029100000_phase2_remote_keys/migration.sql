-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "hmacSecret" TEXT;

-- CreateTable
CREATE TABLE "InputList" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entries" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InputList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "lockId" TEXT,
    "conditionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InputList_shopId_idx" ON "InputList"("shopId");

-- CreateIndex
CREATE INDEX "KeyUsage_shopId_createdAt_idx" ON "KeyUsage"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "KeyUsage_shopId_customerId_idx" ON "KeyUsage"("shopId", "customerId");

-- AddForeignKey
ALTER TABLE "InputList" ADD CONSTRAINT "InputList_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyUsage" ADD CONSTRAINT "KeyUsage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

