ALTER TABLE "User" ADD COLUMN "suspended" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "replacementPreferences" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "calendarTokenHash" TEXT;
CREATE UNIQUE INDEX "User_calendarTokenHash_key" ON "User"("calendarTokenHash");
ALTER TABLE "Match" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 90,
 ADD COLUMN "paymentAlias" TEXT NOT NULL DEFAULT '', ADD COLUMN "results" JSONB,
 ADD COLUMN "balancedTeams" JSONB, ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "seriesId" TEXT, ADD COLUMN "seriesIndex" INTEGER;
CREATE UNIQUE INDEX "Match_seriesId_seriesIndex_key" ON "Match"("seriesId", "seriesIndex");
ALTER TABLE "Notification" ADD COLUMN "dedupKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");

CREATE TABLE "MatchSeries" (
"id" TEXT NOT NULL,
"organizerId" TEXT NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"active" BOOLEAN NOT NULL DEFAULT true,
CONSTRAINT "MatchSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchGuest" (
"id" TEXT NOT NULL,
"matchId" TEXT NOT NULL,
"name" TEXT NOT NULL,
"position" TEXT NOT NULL DEFAULT '',
"level" INTEGER NOT NULL DEFAULT 3,
"active" BOOLEAN NOT NULL DEFAULT true,
"attended" BOOLEAN NOT NULL DEFAULT false,
"claimUserId" TEXT,
"linkedUserId" TEXT,
CONSTRAINT "MatchGuest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchPayment" (
"matchId" TEXT NOT NULL,
"payerKey" TEXT NOT NULL,
"amountCents" INTEGER NOT NULL,
"status" TEXT NOT NULL DEFAULT 'PENDING',
"note" TEXT NOT NULL DEFAULT '',
"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "MatchPayment_pkey" PRIMARY KEY ("matchId", "payerKey")
);

CREATE TABLE "ReplacementRequest" (
"id" TEXT NOT NULL,
"matchId" TEXT NOT NULL,
"zone" TEXT NOT NULL,
"position" TEXT NOT NULL,
"description" TEXT NOT NULL,
"status" TEXT NOT NULL DEFAULT 'OPEN',
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "ReplacementRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReplacementApplication" (
"requestId" TEXT NOT NULL,
"userId" TEXT NOT NULL,
"status" TEXT NOT NULL DEFAULT 'PENDING',
CONSTRAINT "ReplacementApplication_pkey" PRIMARY KEY ("requestId", "userId")
);

CREATE TABLE "UserBlock" (
"blockerId" TEXT NOT NULL,
"blockedId" TEXT NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId")
);

CREATE TABLE "UserReport" (
"id" TEXT NOT NULL,
"reporterId" TEXT NOT NULL,
"reportedId" TEXT NOT NULL,
"kind" TEXT NOT NULL DEFAULT 'USER',
"reason" TEXT NOT NULL,
"status" TEXT NOT NULL DEFAULT 'PENDING',
"resolution" TEXT,
"resolvedBy" TEXT,
"resolvedAt" TIMESTAMP(3),
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchChange" (
"id" TEXT NOT NULL,
"matchId" TEXT NOT NULL,
"source" TEXT NOT NULL,
"before" JSONB NOT NULL,
"after" JSONB NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "MatchChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MatchGuest_matchId_idx" ON "MatchGuest"("matchId");

CREATE UNIQUE INDEX "ReplacementRequest_matchId_key" ON "ReplacementRequest"("matchId");

ALTER TABLE "MatchSeries" ADD CONSTRAINT "MatchSeries_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MatchGuest" ADD CONSTRAINT "MatchGuest_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MatchGuest" ADD CONSTRAINT "MatchGuest_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchPayment" ADD CONSTRAINT "MatchPayment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplacementRequest" ADD CONSTRAINT "ReplacementRequest_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplacementApplication" ADD CONSTRAINT "ReplacementApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplacementApplication" ADD CONSTRAINT "ReplacementApplication_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ReplacementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MatchChange" ADD CONSTRAINT "MatchChange_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Match" ADD CONSTRAINT "Match_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MatchSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
