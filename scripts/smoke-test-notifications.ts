import { prisma } from "../src/lib/db";
import { notifyLoanBorrowed, notifyLoanOverdue, notifyReturnRequested } from "../src/lib/notifications";

async function main() {
  const now = new Date();
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const dueAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const borrowDueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const loanBorrowed = await notifyLoanBorrowed({
    loanId: `test-loan-borrowed-${stamp}`,
    loanRequestId: `test-borrow-request-${stamp}`,
    gameTitle: "[테스트] 대여 완료 알림",
    borrowerName: "테스트 사용자",
    borrowerLoginId: "test-user",
    borrowerStudentId: "0000",
    borrowedAt: now,
    dueAt: borrowDueAt,
    userId: `test-user-${stamp}`
  });

  const returnRequested = await notifyReturnRequested({
    loanId: `test-loan-return-${stamp}`,
    loanRequestId: `test-return-request-${stamp}`,
    gameTitle: "[테스트] 반납 요청 알림",
    borrowerName: "테스트 사용자",
    borrowerLoginId: "test-user",
    borrowerStudentId: "0000",
    dueAt,
    requestedAt: now,
    userId: `test-user-${stamp}`
  });

  const overdue = await notifyLoanOverdue({
    loanId: `test-loan-overdue-${stamp}`,
    gameTitle: "[테스트] 반납 지연 알림",
    borrowerName: "테스트 사용자",
    borrowerLoginId: "test-user",
    borrowerStudentId: "0000",
    dueAt,
    userId: `test-user-${stamp}`,
    dedupeDate: stamp
  });

  console.log(
    JSON.stringify(
      {
        loanBorrowed,
        returnRequested,
        overdue
      },
      null,
      2
    )
  );

  if (!loanBorrowed.sent || !returnRequested.sent || !overdue.sent) {
    process.exitCode = 1;
  }
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
