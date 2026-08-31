CREATE TABLE "ServiceHeartbeat" (
  "id" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceHeartbeat_service_createdAt_idx"
  ON "ServiceHeartbeat"("service", "createdAt");

