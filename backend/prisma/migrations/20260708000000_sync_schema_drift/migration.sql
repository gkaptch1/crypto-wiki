-- AlterTable
ALTER TABLE "Definition" DROP COLUMN "bodyLatex";

-- CreateIndex
CREATE UNIQUE INDEX "DefinitionVersion_definitionId_slug_key" ON "DefinitionVersion"("definitionId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "DefinitionVersion_definitionId_order_key" ON "DefinitionVersion"("definitionId", "order");

