import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { ReturnDialog } from "@/app/borrow-dialog";
import { RatingDialog } from "@/app/rating-dialog";
import { StarRating } from "@/app/star-rating";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRatingReasonLabel } from "@/lib/game-rating";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AccountPage() {
  const user = await requireUser();
  const now = new Date();
  const [loans, ratings] = await Promise.all([
    prisma.loan.findMany({
      where: {
        borrowerId: user.id,
        status: "ACTIVE"
      },
      include: {
        game: {
          select: {
            title: true,
            players: true,
            bestPlayers: true,
            playTime: true,
            genre: true,
            weight: true
          }
        },
        requests: {
          where: {
            type: "RETURN",
            status: "PENDING"
          },
          select: {
            id: true,
            requestedAt: true
          },
          orderBy: { requestedAt: "desc" },
          take: 1
        },
      },
      orderBy: { dueAt: "asc" }
    }),
    prisma.gameRating.findMany({
      where: {
        userId: user.id,
        isHidden: false
      },
      include: {
        game: {
          select: {
            id: true,
            title: true,
            players: true,
            bestPlayers: true,
            playTime: true,
            genre: true,
            weight: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 40
    })
  ]);

  const returnableLoans = loans.filter((loan) => loan.requests.length === 0);
  const pendingReturnLoans = loans.filter((loan) => loan.requests.length > 0);
  const overdueCount = returnableLoans.filter((loan) => loan.dueAt.getTime() < now.getTime()).length;
  const dueSoonCount = returnableLoans.filter((loan) => {
    const remainingMs = loan.dueAt.getTime() - now.getTime();
    return remainingMs >= 0 && remainingMs <= DAY_MS;
  }).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">My Page</p>
          <h1>내 페이지</h1>
        </div>
        <div className="account-box">
          <span>
            {user.name} <small>{user.loginId}</small>
          </span>
          <Link className="ghost-link" href="/">
            홈
          </Link>
          {user.role === "ADMIN" ? (
            <Link className="ghost-link" href="/admin">
              관리자
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="stats-grid account-stats-grid">
        <div className="stat">
          <span>대여 중</span>
          <strong>{loans.length}</strong>
        </div>
        <div className="stat">
          <span>반납 가능</span>
          <strong>{returnableLoans.length}</strong>
        </div>
        <div className="stat">
          <span>승인 대기</span>
          <strong>{pendingReturnLoans.length}</strong>
        </div>
        <div className="stat">
          <span>기한 임박/초과</span>
          <strong>{dueSoonCount + overdueCount}</strong>
        </div>
        <div className="stat">
          <span>내 평점</span>
          <strong>{ratings.length}</strong>
        </div>
      </section>

      {overdueCount > 0 ? (
        <p className="notice error-notice">반납 기한이 지난 보드게임이 {overdueCount}개 있습니다.</p>
      ) : dueSoonCount > 0 ? (
        <p className="notice warning-notice">반납 기한이 하루 이내인 보드게임이 {dueSoonCount}개 있습니다.</p>
      ) : null}

      <section className="section-block">
        <div className="section-heading">
          <h2>반납 가능한 보드게임</h2>
          <span>{returnableLoans.length}개</span>
        </div>
        <div className="account-loan-list">
          {returnableLoans.map((loan) => {
            const overdue = loan.dueAt.getTime() < now.getTime();
            const dueSoon = !overdue && loan.dueAt.getTime() - now.getTime() <= DAY_MS;
            const details = [
              loan.game.players,
              loan.game.bestPlayers ? `베스트 ${loan.game.bestPlayers}` : "",
              loan.game.playTime ? `${loan.game.playTime}분` : "",
              loan.game.genre,
              loan.game.weight ? `웨이트 ${loan.game.weight}` : ""
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <article className="account-loan-row" key={loan.id}>
                <div>
                  <div className="card-header compact">
                    <h3>{loan.game.title}</h3>
                    <span className={overdue ? "badge red" : dueSoon ? "badge amber" : "badge green"}>
                      {overdue ? "기한 초과" : dueSoon ? "기한 임박" : "반납 가능"}
                    </span>
                  </div>
                  <p className="muted">반납 예정 {dateFormatter.format(loan.dueAt)}</p>
                  {details ? <p className="muted account-loan-detail">{details}</p> : null}
                </div>
                <div className="row-actions">
                  <ReturnDialog loanId={loan.id} gameTitle={loan.game.title} />
                </div>
              </article>
            );
          })}
          {returnableLoans.length === 0 ? (
            <p className="empty account-empty">지금 반납 요청할 수 있는 보드게임이 없습니다.</p>
          ) : null}
        </div>
      </section>

      {pendingReturnLoans.length > 0 ? (
        <section className="section-block">
          <div className="section-heading">
            <h2>반납 승인 대기</h2>
            <span>{pendingReturnLoans.length}개</span>
          </div>
          <div className="account-loan-list">
            {pendingReturnLoans.map((loan) => (
              <article className="account-loan-row" key={loan.id}>
                <div>
                  <div className="card-header compact">
                    <h3>{loan.game.title}</h3>
                    <span className="badge amber">승인 대기</span>
                  </div>
                  <p className="muted">
                    요청 {dateFormatter.format(loan.requests[0].requestedAt)} · 반납 예정 {dateFormatter.format(loan.dueAt)}
                  </p>
                </div>
                <span className="muted">관리자 확인 중</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section-block">
        <div className="section-heading">
          <h2>내가 매긴 평점</h2>
          <span>{ratings.length}개</span>
        </div>
        <div className="account-loan-list">
          {ratings.map((rating) => {
            const details = [
              rating.game.players,
              rating.game.bestPlayers ? `베스트 ${rating.game.bestPlayers}` : "",
              rating.game.playTime ? `${rating.game.playTime}분` : "",
              rating.game.genre,
              rating.game.weight ? `웨이트 ${rating.game.weight}` : ""
            ]
              .filter(Boolean)
              .join(" · ");
            const reasonLabels = rating.reasonTags.map(getRatingReasonLabel).join(", ");

            return (
              <article className="account-loan-row account-rating-row" key={rating.id}>
                <div>
                  <div className="card-header compact">
                    <h3>{rating.game.title}</h3>
                    <StarRating score={rating.score} />
                  </div>
                  {details ? <p className="muted account-loan-detail">{details}</p> : null}
                  <p className="participants">이유: {reasonLabels}</p>
                  {rating.comment ? <p className="account-rating-comment">{rating.comment}</p> : null}
                </div>
                <div className="row-actions account-rating-actions">
                  <span className="muted">수정 {dateFormatter.format(rating.updatedAt)}</span>
                  <RatingDialog
                    gameId={rating.game.id}
                    gameTitle={rating.game.title}
                    rating={{
                      score: rating.score,
                      playedStatus: rating.playedStatus,
                      reasonTags: rating.reasonTags,
                      comment: rating.comment
                    }}
                  />
                </div>
              </article>
            );
          })}
          {ratings.length === 0 ? (
            <p className="empty account-empty">아직 매긴 평점이 없습니다.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
