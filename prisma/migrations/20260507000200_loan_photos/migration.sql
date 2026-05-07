CREATE TYPE "LoanPhotoType" AS ENUM ('BORROW', 'RETURN');

CREATE TABLE "LoanPhoto" (
    "id" TEXT NOT NULL,
    "type" "LoanPhotoType" NOT NULL,
    "loanId" TEXT NOT NULL,
    "loanRequestId" TEXT,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanPhoto_loanId_idx" ON "LoanPhoto"("loanId");
CREATE INDEX "LoanPhoto_loanRequestId_idx" ON "LoanPhoto"("loanRequestId");
CREATE INDEX "LoanPhoto_type_idx" ON "LoanPhoto"("type");

ALTER TABLE "LoanPhoto" ADD CONSTRAINT "LoanPhoto_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanPhoto" ADD CONSTRAINT "LoanPhoto_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "LoanRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
