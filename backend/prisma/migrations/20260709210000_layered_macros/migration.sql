-- AlterTable
ALTER TABLE "Revision" ADD COLUMN     "localMacros" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "macros" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "MacroName" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "MacroName_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MacroName_name_key" ON "MacroName"("name");

-- AddForeignKey
ALTER TABLE "MacroName" ADD CONSTRAINT "MacroName_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

