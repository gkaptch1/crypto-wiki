-- Phase 1 restructure: DefinitionVersion -> Formulation + immutable Revisions,
-- Definition slug/title split, MacroSet visibility + snapshots.
-- Pre-Phase-1 data is dev seed data only; wipe it so the NOT NULL additions apply.
TRUNCATE TABLE "DefinitionVersion", "Definition", "MacroSet", "Category" CASCADE;

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "MacroSetVisibility" AS ENUM ('public', 'unlisted', 'anonymous');

-- DropForeignKey
ALTER TABLE "DefinitionVersion" DROP CONSTRAINT "DefinitionVersion_defaultMacroSetId_fkey";

-- DropForeignKey
ALTER TABLE "DefinitionVersion" DROP CONSTRAINT "DefinitionVersion_definitionId_fkey";

-- AlterTable
ALTER TABLE "Definition" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MacroSet" ADD COLUMN     "visibility" "MacroSetVisibility" NOT NULL DEFAULT 'public',
ALTER COLUMN "name" SET NOT NULL;

-- DropTable
DROP TABLE "DefinitionVersion";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "Formulation" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "citePaper" TEXT,
    "citeAuthors" TEXT,
    "citeVenue" TEXT,
    "citeYear" INTEGER,
    "citeDoi" TEXT,
    "citeEprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "definitionId" INTEGER NOT NULL,
    "defaultMacroSetId" INTEGER,

    CONSTRAINT "Formulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" SERIAL NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'draft',
    "number" INTEGER,
    "bodyLatex" TEXT NOT NULL,
    "commentaryMd" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "formulationId" INTEGER NOT NULL,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroSetSnapshot" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "macros" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "macroSetId" INTEGER NOT NULL,

    CONSTRAINT "MacroSetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Formulation_definitionId_slug_key" ON "Formulation"("definitionId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Formulation_definitionId_order_key" ON "Formulation"("definitionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_formulationId_number_key" ON "Revision"("formulationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MacroSetSnapshot_macroSetId_hash_key" ON "MacroSetSnapshot"("macroSetId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "Definition_slug_key" ON "Definition"("slug");

-- AddForeignKey
ALTER TABLE "Formulation" ADD CONSTRAINT "Formulation_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "Definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Formulation" ADD CONSTRAINT "Formulation_defaultMacroSetId_fkey" FOREIGN KEY ("defaultMacroSetId") REFERENCES "MacroSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "Formulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroSetSnapshot" ADD CONSTRAINT "MacroSetSnapshot_macroSetId_fkey" FOREIGN KEY ("macroSetId") REFERENCES "MacroSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

