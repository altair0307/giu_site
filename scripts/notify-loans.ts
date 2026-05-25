import { prisma } from "../src/lib/db";
import { notifyLoanOverdue } from "../src/lib/notifications";

const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function seoulDateKey(date = new Date()) {
  return SEOUL_DATE_FORMATTER.format(date);
}

async function main() {
  const now = new Date();
  const dedupeDate = seoulDateKey(now);
  const overdueLoans = await prisma.loan.findMany({
    where: {
      status: "ACTIVE",
      dueAt: { lt: now }
    },
    include: {
      game: { select: { title: true } },
      borrower: { select: { id: true, name: true, loginId: true, studentId: true } }
    },
    orderBy: { dueAt: "asc" },
    take: 50
  });

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const loan of overdueLoans) {
    const result = await notifyLoanOverdue({
      loanId: loan.id,
      gameTitle: loan.game.title,
      borrowerName: loan.borrower.name,
      borrowerLoginId: loan.borrower.loginId,
      borrowerStudentId: loan.borrower.studentId,
      dueAt: loan.dueAt,
      userId: loan.borrower.id,
      dedupeDate
    });

    if (result.sent) {
      sentCount += 1;
    } else if (result.reason === "duplicate") {
      skippedCount += 1;
    } else {
      failedCount += 1;
    }
  }

  console.log(
    `Loan notification job finished. overdue=${overdueLoans.length}, sent=${sentCount}, skipped=${skippedCount}, failed=${failedCount}`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
