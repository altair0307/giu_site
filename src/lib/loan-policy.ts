import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const DEFAULT_LOAN_POLICY = {
  maxActiveLoansPerUser: 3,
  maxLoansPerMonth: 5,
  loanPeriodDays: 7
} as const;

type LoanPolicyClient = Pick<Prisma.TransactionClient, "loanPolicy">;

export async function getLoanPolicy(client: LoanPolicyClient = prisma) {
  const policy = await client.loanPolicy.findUnique({ where: { id: "default" } });

  return policy ?? DEFAULT_LOAN_POLICY;
}

export function loanDueAt(borrowedAt: Date, loanPeriodDays: number) {
  return new Date(borrowedAt.getTime() + loanPeriodDays * 24 * 60 * 60 * 1000);
}

export function getKoreaMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    start: new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+09:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`)
  };
}

export async function assertUserCanBorrow(client: Prisma.TransactionClient, userId: string) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const policy = await getLoanPolicy(client);
  const monthRange = getKoreaMonthRange();
  const [activeLoanCount, monthlyLoanCount] = await Promise.all([
    client.loan.count({ where: { borrowerId: userId, status: "ACTIVE" } }),
    client.loanActivityLog.count({
      where: {
        type: "BORROW",
        borrowerId: userId,
        occurredAt: { gte: monthRange.start, lt: monthRange.end }
      }
    })
  ]);

  if (activeLoanCount >= policy.maxActiveLoansPerUser) {
    throw new Error(`동시에 최대 ${policy.maxActiveLoansPerUser}개까지만 대여할 수 있습니다.`);
  }

  if (monthlyLoanCount >= policy.maxLoansPerMonth) {
    throw new Error(`이번 달에는 최대 ${policy.maxLoansPerMonth}회까지만 대여할 수 있습니다.`);
  }

  return policy;
}
