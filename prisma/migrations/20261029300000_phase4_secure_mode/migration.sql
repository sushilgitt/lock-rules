-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "secureEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "secureExcluded" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "secureReport" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "secureThemeId" TEXT;

-- AlterTable
ALTER TABLE "Lock" ADD COLUMN     "liquidCode" TEXT;

