ALTER TABLE "CallMetric"
ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'Unknown',
ADD COLUMN "qualityScore" INTEGER;
