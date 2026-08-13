CREATE TABLE "LoanPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "maxActiveLoansPerUser" INTEGER NOT NULL DEFAULT 3,
    "loanPeriodDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanPolicy_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LoanPolicy" ("id", "maxActiveLoansPerUser", "loanPeriodDays", "updatedAt")
VALUES ('default', 3, 7, CURRENT_TIMESTAMP);
