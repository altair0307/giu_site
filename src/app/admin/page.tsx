import Link from "next/link";
import { approveLoanRequestAction, rejectLoanRequestAction } from "@/app/actions";
import { prisma } from "@/lib/db";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export default async function AdminPage() {
  const [loanRequests, userCount, gameCount, meetupCount] = await Promise.all([
    prisma.loanRequest.findMany({
      where: { status: "PENDING" },
      include: {
        game: true,
        requester: { select: { name: true, loginId: true, studentId: true } },
        loan: {
          include: {
            borrower: { select: { name: true, loginId: true, studentId: true } },
            photos: {
              where: { type: "RETURN" },
              orderBy: { createdAt: "desc" },
              take: 1
            }
          }
        },
        photos: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { requestedAt: "asc" },
      take: 80
    }),
    prisma.user.count(),
    prisma.game.count(),
    prisma.meetup.count({ where: { startsAt: { gte: new Date() } } })
  ]);

  return (
    <section className="admin-page">
      <div className="admin-summary-grid">
        <Link className="admin-summary-card" href="/admin/users">
          <span>회원</span>
          <strong>{userCount}</strong>
        </Link>
        <Link className="admin-summary-card" href="/admin/games">
          <span>보드게임</span>
          <strong>{gameCount}</strong>
        </Link>
        <Link className="admin-summary-card" href="/admin/meetups">
          <span>예정 약속</span>
          <strong>{meetupCount}</strong>
        </Link>
        <Link className="admin-summary-card" href="/admin">
          <span>승인 대기</span>
          <strong>{loanRequests.length}</strong>
        </Link>
      </div>

      <section className="section-block">
        <div className="section-heading">
          <h2>대여/반납 승인</h2>
          <span>{loanRequests.length}건 대기</span>
        </div>
        <div className="admin-meetup-list">
          {loanRequests.map((request) => (
            <article className="admin-meetup-row" key={request.id}>
              <div>
                <strong>
                  {request.type === "BORROW" ? "대여 요청" : "반납 요청"} · {request.game.title}
                </strong>
                <p className="muted">
                  {request.requester.name}({request.requester.loginId}
                  {request.requester.studentId ? ` · ${request.requester.studentId}` : ""}) ·{" "}
                  {dateFormatter.format(request.requestedAt)}
                  {request.type === "RETURN" && request.loan
                    ? ` · 대여자 ${request.loan.borrower.name} · 반납 예정 ${dateFormatter.format(request.loan.dueAt)}`
                    : ""}
                </p>
                {request.photos[0] || request.loan?.photos[0] ? (
                  <a className="photo-preview-link" href={`/loan-photos/${request.photos[0]?.id ?? request.loan?.photos[0]?.id}`} target="_blank">
                    <img
                      alt={`${request.game.title} ${request.type === "RETURN" ? "반납" : "대여"} 사진`}
                      src={`/loan-photos/${request.photos[0]?.id ?? request.loan?.photos[0]?.id}`}
                    />
                    <span>업로드 사진 확인</span>
                  </a>
                ) : null}
              </div>
              <div className="row-actions">
                <form action={approveLoanRequestAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button className="secondary-button">승인</button>
                </form>
                <form action={rejectLoanRequestAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button className="ghost-button">거절</button>
                </form>
              </div>
            </article>
          ))}
          {loanRequests.length === 0 ? <p className="empty">승인 대기 중인 대여/반납 요청이 없습니다.</p> : null}
        </div>
      </section>
    </section>
  );
}
