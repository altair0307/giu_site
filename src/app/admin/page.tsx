import Image from "next/image";
import Link from "next/link";
import { approveLoanRequestAction, rejectLoanRequestAction } from "@/app/actions";
import { prisma } from "@/lib/db";
import { createKoreaDateFormatter } from "@/lib/date-time";
import { getKoreaMonthRange, getLoanPolicy } from "@/lib/loan-policy";

const dateFormatter = createKoreaDateFormatter({
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

type AdminPageProps = { searchParams: Promise<{ request?: string }> };

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const params = await searchParams;
  const [loanRequests, userCount, gameCount, meetupCount, activityLogCount] = await Promise.all([
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
    prisma.meetup.count({ where: { startsAt: { gte: new Date() } } }),
    Promise.all([prisma.loanActivityLog.count(), prisma.meetupActivityLog.count()]).then(([loanCount, meetupLogCount]) => loanCount + meetupLogCount)
  ]);
  const selectedRequest = loanRequests.find((request) => request.id === params.request) ?? loanRequests[0] ?? null;
  const monthRange = getKoreaMonthRange(new Date());
  const [selectedMonthlyLoans, selectedActiveLoans, loanPolicy] = selectedRequest
    ? await Promise.all([
        prisma.loanActivityLog.count({ where: { type: "BORROW", borrowerId: selectedRequest.requesterId, occurredAt: { gte: monthRange.start, lt: monthRange.end } } }),
        prisma.loan.count({ where: { borrowerId: selectedRequest.requesterId, status: "ACTIVE" } }),
        getLoanPolicy()
      ])
    : [0, 0, await getLoanPolicy()];

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
        <Link className="admin-summary-card" href="/admin/logs">
          <span>운영 로그</span>
          <strong>{activityLogCount}</strong>
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
        <div className="approval-workspace">
        <div className="admin-meetup-list approval-list">
          {loanRequests.map((request) => (
            <article className={selectedRequest?.id === request.id ? "admin-meetup-row selected" : "admin-meetup-row"} key={request.id}>
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
                    <Image
                      alt={`${request.game.title} ${request.type === "RETURN" ? "반납" : "대여"} 사진`}
                      src={`/loan-photos/${request.photos[0]?.id ?? request.loan?.photos[0]?.id}`}
                      width={132}
                      height={88}
                      unoptimized
                    />
                    <span>업로드 사진 확인</span>
                  </a>
                ) : null}
              </div>
              <div className="row-actions">
                <Link className="ghost-link" href={`/admin?request=${request.id}`}>상세 보기</Link>
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
        {selectedRequest ? (
          <aside className="approval-detail panel">
            <div className="section-heading"><h2>신청 상세</h2><span className="badge amber">대기 중</span></div>
            <dl>
              <div><dt>신청자</dt><dd>{selectedRequest.requester.name}<small>{selectedRequest.requester.loginId}</small></dd></div>
              <div><dt>유형</dt><dd>{selectedRequest.type === "BORROW" ? "대여 신청" : "반납 신청"}</dd></div>
              <div><dt>게임</dt><dd>{selectedRequest.game.title}</dd></div>
              <div><dt>신청일</dt><dd>{dateFormatter.format(selectedRequest.requestedAt)}</dd></div>
              <div><dt>월 대여</dt><dd>{selectedMonthlyLoans}/{loanPolicy.maxLoansPerMonth}회</dd></div>
              <div><dt>현재 대여</dt><dd>{selectedActiveLoans}/{loanPolicy.maxActiveLoansPerUser}개</dd></div>
            </dl>
            {selectedRequest.photos[0] || selectedRequest.loan?.photos[0] ? (
              <a className="approval-detail-photo" href={`/loan-photos/${selectedRequest.photos[0]?.id ?? selectedRequest.loan?.photos[0]?.id}`} target="_blank">
                <Image alt="신청 증빙 사진" src={`/loan-photos/${selectedRequest.photos[0]?.id ?? selectedRequest.loan?.photos[0]?.id}`} width={360} height={220} unoptimized />
                <span>원본 사진 열기</span>
              </a>
            ) : <p className="empty">첨부된 증빙 사진이 없습니다.</p>}
            <div className="approval-detail-actions">
              <form action={rejectLoanRequestAction}><input type="hidden" name="requestId" value={selectedRequest.id} /><button className="danger-button">거절</button></form>
              <form action={approveLoanRequestAction}><input type="hidden" name="requestId" value={selectedRequest.id} /><button className="primary-button">승인</button></form>
            </div>
          </aside>
        ) : null}
        </div>
      </section>
    </section>
  );
}
