CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "googleSub" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatar" TEXT,
  "admin" BOOLEAN NOT NULL DEFAULT false,
  "profile" JSONB NOT NULL DEFAULT '{}',
  "recruitmentAlerts" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "zone" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'PLAYER',
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId", "userId")
);

CREATE TABLE "Tournament" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "season" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MANUAL',
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentRegistration" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "externalName" TEXT,
  "division" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "TournamentRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Match" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "address" TEXT NOT NULL,
  "courtCode" TEXT,
  "priceCents" INTEGER,
  "capacity" INTEGER NOT NULL DEFAULT 12,
  "type" TEXT NOT NULL DEFAULT 'RECREATIONAL',
  "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "opponent" TEXT,
  "externalKey" TEXT,
  "organizerId" TEXT NOT NULL,
  "teamId" TEXT,
  "tournamentId" TEXT,
  "closedCost" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchParticipant" (
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "attended" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("matchId", "userId")
);

CREATE TABLE "RecruitmentPost" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecruitmentApplication" (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "RecruitmentApplication_pkey" PRIMARY KEY ("postId", "userId")
);

CREATE TABLE "PlayerRating" (
  "authorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "attack" INTEGER NOT NULL,
  "reception" INTEGER NOT NULL,
  "defense" INTEGER NOT NULL,
  "jump" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerRating_pkey" PRIMARY KEY ("authorId", "targetId")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "link" TEXT NOT NULL,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportExecution" (
  "id" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "pdf" BYTEA NOT NULL,
  "rawText" TEXT NOT NULL,
  "candidates" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "message" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

CREATE UNIQUE INDEX "TournamentRegistration_teamId_tournamentId_key" ON "TournamentRegistration"("teamId", "tournamentId");

CREATE UNIQUE INDEX "TournamentRegistration_tournamentId_externalName_division_key" ON "TournamentRegistration"("tournamentId", "externalName", "division");

CREATE UNIQUE INDEX "Match_externalKey_key" ON "Match"("externalKey");

CREATE INDEX "Match_startsAt_visibility_idx" ON "Match"("startsAt", "visibility");

CREATE INDEX "MatchParticipant_userId_idx" ON "MatchParticipant"("userId");

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE UNIQUE INDEX "ImportExecution_hash_key" ON "ImportExecution"("hash");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Match" ADD CONSTRAINT "Match_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Match" ADD CONSTRAINT "Match_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentPost" ADD CONSTRAINT "RecruitmentPost_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_postId_fkey" FOREIGN KEY ("postId") REFERENCES "RecruitmentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerRating" ADD CONSTRAINT "PlayerRating_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerRating" ADD CONSTRAINT "PlayerRating_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
