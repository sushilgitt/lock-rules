-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "validationId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lock" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resources" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hideFromLists" BOOLEAN NOT NULL DEFAULT false,
    "hideNavLinks" BOOLEAN NOT NULL DEFAULT false,
    "deniedAction" TEXT NOT NULL DEFAULT 'message',
    "deniedMessage" TEXT,
    "redirectUrl" TEXT,
    "storeExceptions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LockKey" (
    "id" TEXT NOT NULL,
    "lockId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LockKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Condition" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "inverted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Condition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Lock_shopId_idx" ON "Lock"("shopId");

-- CreateIndex
CREATE INDEX "LockKey_lockId_idx" ON "LockKey"("lockId");

-- CreateIndex
CREATE INDEX "Condition_keyId_idx" ON "Condition"("keyId");

-- AddForeignKey
ALTER TABLE "Lock" ADD CONSTRAINT "Lock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LockKey" ADD CONSTRAINT "LockKey_lockId_fkey" FOREIGN KEY ("lockId") REFERENCES "Lock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Condition" ADD CONSTRAINT "Condition_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "LockKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

