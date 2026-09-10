CREATE TABLE "CallMetric" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rtt" DOUBLE PRECISION,
    "jitter" DOUBLE PRECISION,
    "packetsSent" INTEGER NOT NULL DEFAULT 0,
    "packetsReceived" INTEGER NOT NULL DEFAULT 0,
    "packetsLost" INTEGER NOT NULL DEFAULT 0,
    "packetLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bytesSent" INTEGER NOT NULL DEFAULT 0,
    "bytesReceived" INTEGER NOT NULL DEFAULT 0,
    "bitrate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codec" TEXT,
    "audioLevel" DOUBLE PRECISION,
    "candidateType" TEXT,

    CONSTRAINT "CallMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallMetric_callId_timestamp_idx" ON "CallMetric"("callId", "timestamp");

ALTER TABLE "CallMetric" ADD CONSTRAINT "CallMetric_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
