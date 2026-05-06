CREATE TYPE "LoanRequestType" AS ENUM ('BORROW', 'RETURN');

CREATE TYPE "LoanRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "LoanRequest" (
    "id" TEXT NOT NULL,
    "type" "LoanRequestType" NOT NULL,
    "status" "LoanRequestStatus" NOT NULL DEFAULT 'PENDING',
    "gameId" TEXT NOT NULL,
    "loanId" TEXT,
    "requesterId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanRequest_status_idx" ON "LoanRequest"("status");
CREATE INDEX "LoanRequest_type_idx" ON "LoanRequest"("type");
CREATE INDEX "LoanRequest_gameId_idx" ON "LoanRequest"("gameId");
CREATE INDEX "LoanRequest_loanId_idx" ON "LoanRequest"("loanId");
CREATE INDEX "LoanRequest_requesterId_idx" ON "LoanRequest"("requesterId");
CREATE INDEX "LoanRequest_reviewerId_idx" ON "LoanRequest"("reviewerId");

ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
