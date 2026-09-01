CREATE TYPE "CallStatus" AS ENUM ('INITIATED', 'RINGING', 'CONNECTED', 'ENDED', 'REJECTED', 'FAILED', 'MISSED');

CREATE TABLE "Call" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "callerId" TEXT NOT NULL,
  "receiverId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "duration" INTEGER,
  "status" "CallStatus" NOT NULL DEFAULT 'INITIATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallParticipant" (
  "id" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Call_callerId_createdAt_idx" ON "Call"("callerId", "createdAt");
CREATE INDEX "Call_receiverId_createdAt_idx" ON "Call"("receiverId", "createdAt");
CREATE INDEX "Call_roomId_idx" ON "Call"("roomId");
CREATE UNIQUE INDEX "CallParticipant_callId_userId_key" ON "CallParticipant"("callId", "userId");
CREATE INDEX "CallParticipant_userId_idx" ON "CallParticipant"("userId");
ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
