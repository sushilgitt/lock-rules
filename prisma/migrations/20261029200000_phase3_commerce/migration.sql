-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "paymentCustomizationId" TEXT,
ADD COLUMN     "seoHiddenIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Lock" ADD COLUMN     "protect" TEXT NOT NULL DEFAULT 'page',
ADD COLUMN     "seoHidden" BOOLEAN NOT NULL DEFAULT false;

