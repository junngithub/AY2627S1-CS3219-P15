-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "createdByUserId" TEXT;

-- CreateEnum
CREATE TYPE "SupplierActionType" AS ENUM ('created', 'edited', 'approved', 'rejected', 'pending', 'deleted');

-- CreateTable
CREATE TABLE "SupplierAction" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "supplierName" TEXT NOT NULL,
    "action" "SupplierActionType" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierAction_supplierId_idx" ON "SupplierAction"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierAction_actorUserId_idx" ON "SupplierAction"("actorUserId");
