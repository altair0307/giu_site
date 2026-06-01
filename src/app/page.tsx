import Link from "next/link";
import { redirect } from "next/navigation";
import type { GameStatus, Prisma } from "@prisma/client";
import {
  joinMeetupAction,
  leaveMeetupAction,
  logoutAction,
} from "@/app/actions";
import { BorrowDialog, ReturnDialog } from "@/app/borrow-dialog";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { matchesGameDetailFilters } from "@/lib/game-search";

const PAGE_SIZE = 24;

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const DAY_MS = 24 * 60 * 60 * 1000;

type HomePageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    playerCount?: string;
    bestPlayerCount?: string;
    playTime?: string;
    genre?: string;
    weight?: string;
    page?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const playerCount = (params.playerCount ?? "").trim();
  const bestPlayerCount = (params.bestPlayerCount ?? "").trim();
  const playTime = (params.playTime ?? "").trim();
  const genre = (params.genre ?? "").trim();
  const weight = (params.weight ?? "").trim();
  const status: GameStatus | "ALL" =
    params.status === "BORROWED" || params.status === "AVAILABLE" ? params.status : "ALL";
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const detailFilters = {
    playerCount,
    bestPlayerCount,
    playTime,
    genre,
    weight
  };

  const gameWhere: Prisma.GameWhereInput = {
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    ...(status !== "ALL" ? { status } : {})
  };

  const now = new Date();
  const [gameRows, availableCount, pendingLoanRequestCount, meetups, myActiveLoans] = await Promise.all([
    prisma.game.findMany({
      where: gameWhere,
      orderBy: [{ status: "asc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        players: true,
        bestPlayers: true,
        playTime: true,
        genre: true,
        weight: true,
        status: true,
        loans: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            dueAt: true,
            borrower: {
              select: { id: true, name: true, loginId: true }
            },
            requests: {
              where: {
                type: "RETURN",
                status: "PENDING"
              },
              select: { id: true },
              orderBy: { requestedAt: "asc" },
              take: 1
            }
          }
        },
        loanRequests: {
          where: {
            type: "BORROW",
            status: "PENDING"
          },
          select: {
            id: true,
            requester: {
              select: { id: true, name: true, loginId: true }
            }
          },
          orderBy: { requestedAt: "asc" },
          take: 1
        },
        meetups: {
          where: {
            startsAt: { gte: now }
          },
          select: {
            id: true,
            startsAt: true
          },
          orderBy: { startsAt: "asc" },
          take: 1
        }
      }
    }),
    prisma.game.count({
      where: {
        status: "AVAILABLE",
        meetups: {
          none: {
            startsAt: { gte: now }
          }
        }
      }
    }),
    prisma.loanRequest.count({ where: { status: "PENDING" } }),
    prisma.meetup.findMany({
      where: { startsAt: { gte: new Date() } },
      include: {
        host: { select: { name: true, loginId: true } },
        game: true,
        table: true,
        participants: {
          include: {
            user: { select: { id: true, name: true, loginId: true } }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { startsAt: "asc" },
      take: 12
    }),
    prisma.loan.findMany({
      where: {
        borrowerId: user.id,
        status: "ACTIVE"
      },
      include: {
        game: {
          select: { title: true }
        }
      },
      orderBy: { dueAt: "asc" },
      take: 12
    })
  ]);

  const filteredGames = gameRows.filter((game) => matchesGameDetailFilters(game, detailFilters));
  const gameTotal = filteredGames.length;
  const games = filteredGames.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(gameTotal / PAGE_SIZE));
  const urgentLoans = myActiveLoans.filter((loan) => loan.dueAt.getTime() - now.getTime() <= DAY_MS);
  const pageHref = (targetPage: number) => {
    const hrefParams = new URLSearchParams();

    if (q) hrefParams.set("q", q);
    if (status !== "ALL") hrefParams.set("status", status);
    if (playerCount) hrefParams.set("playerCount", playerCount);
    if (bestPlayerCount) hrefParams.set("bestPlayerCount", bestPlayerCount);
    if (playTime) hrefParams.set("playTime", playTime);
    if (genre) hrefParams.set("genre", genre);
    if (weight) hrefParams.set("weight", weight);
    hrefParams.set("page", String(targetPage));

    return `/?${hrefParams.toString()}`;
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Club Room</p>
          <h1>보드게임 대여와 약속</h1>
        </div>
        <div className="account-box">
          <span>
            {user.name} <small>{user.loginId}</small>
          </span>
          {user.role === "ADMIN" ? (
            <Link className="ghost-link" href="/admin">
              관리자
            </Link>
          ) : null}
          <Link className="ghost-link" href="/account">
            내 페이지
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="stats-grid">
        <div className="stat">
          <span>검색 결과</span>
          <strong>{gameTotal}</strong>
        </div>
        <div className="stat">
          <span>대여 가능</span>
          <strong>{availableCount}</strong>
        </div>
        <div className="stat">
          <span>승인 대기</span>
          <strong>{pendingLoanRequestCount}</strong>
        </div>
        <div className="stat">
          <span>예정 약속</span>
          <strong>{meetups.length}</strong>
        </div>
      </section>

      {urgentLoans.length > 0 ? (
        <section className="loan-alert-list">
          {urgentLoans.map((loan) => {
            const overdue = loan.dueAt.getTime() < now.getTime();

            return (
              <p className={overdue ? "notice error-notice" : "notice warning-notice"} key={loan.id}>
                {overdue
                  ? `${loan.game.title} 반납 기한이 지났습니다. 가능한 빨리 반납 사진을 올려주세요.`
                  : `${loan.game.title} 반납 기한이 하루 이내입니다. 반납 예정: ${dateFormatter.format(loan.dueAt)}`}
              </p>
            );
          })}
        </section>
      ) : null}

      <section className="content-grid">
        <div className="main-column">
          <section className="section-block">
            <div className="section-heading">
              <h2>보드게임</h2>
              <span>페이지 {page}/{totalPages}</span>
            </div>

            <form className="filter-bar game-search-bar">
              <input name="q" defaultValue={q} placeholder="게임명 검색" />
              <select name="status" defaultValue={status}>
                <option value="ALL">전체 상태</option>
                <option value="AVAILABLE">대여 가능</option>
                <option value="BORROWED">대여 중</option>
              </select>
              <input name="playerCount" type="number" min="1" defaultValue={playerCount} placeholder="인원" />
              <input name="bestPlayerCount" type="number" min="1" defaultValue={bestPlayerCount} placeholder="베스트 인원" />
              <input name="playTime" type="number" min="1" defaultValue={playTime} placeholder="시간(분)" />
              <input name="genre" defaultValue={genre} placeholder="장르" />
              <input name="weight" defaultValue={weight} placeholder="웨이트" />
              <button className="secondary-button">검색</button>
            </form>

            <div className="game-table">
              <div className="game-table-head">
                <span>게임</span>
                <span>정보</span>
                <span>상태</span>
                <span>작업</span>
              </div>
              {games.map((game) => {
                const activeLoan = game.loans[0];
                const pendingBorrowRequest = game.loanRequests[0];
                const upcomingMeetup = game.meetups[0];
                const pendingReturnRequest = activeLoan?.requests[0];
                const canReturn =
                  activeLoan &&
                  !pendingReturnRequest &&
                  (activeLoan.borrower.id === user.id || user.role === "ADMIN");

                return (
                  <article className="game-row" key={game.id}>
                    <strong>{game.title}</strong>
                    <span>
                      {[game.players, game.bestPlayers ? `베스트 ${game.bestPlayers}` : "", game.playTime ? `${game.playTime}분` : "", game.genre, game.weight ? `웨이트 ${game.weight}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className={game.status === "AVAILABLE" && !upcomingMeetup ? "badge green" : "badge amber"}>
                      {game.status === "AVAILABLE" && pendingBorrowRequest
                        ? `${pendingBorrowRequest.requester.name} 대여 승인 대기`
                        : game.status === "AVAILABLE" && upcomingMeetup
                          ? `약속 예정 ${dateFormatter.format(upcomingMeetup.startsAt)}`
                        : game.status === "AVAILABLE"
                          ? "대여 가능"
                          : pendingReturnRequest
                            ? "반납 승인 대기"
                            : `${activeLoan?.borrower.name ?? "회원"} 대여 중`}
                    </span>
                    {game.status === "AVAILABLE" && !pendingBorrowRequest && !upcomingMeetup ? (
                      <BorrowDialog gameId={game.id} gameTitle={game.title} />
                    ) : canReturn && activeLoan ? (
                      <ReturnDialog loanId={activeLoan.id} gameTitle={game.title} />
                    ) : pendingBorrowRequest ? (
                      <span className="muted">관리자 승인 대기</span>
                    ) : pendingReturnRequest ? (
                      <span className="muted">반납 승인 대기</span>
                    ) : (
                      <span className="muted">반납 예정 {activeLoan ? dateFormatter.format(activeLoan.dueAt) : "-"}</span>
                    )}
                  </article>
                );
              })}
              {games.length === 0 ? <p className="empty">조건에 맞는 게임이 없습니다.</p> : null}
            </div>

            <div className="pager">
              <Link
                className={page <= 1 ? "pager-link disabled" : "pager-link"}
                href={pageHref(Math.max(1, page - 1))}
              >
                이전
              </Link>
              <Link
                className={page >= totalPages ? "pager-link disabled" : "pager-link"}
                href={pageHref(Math.min(totalPages, page + 1))}
              >
                다음
              </Link>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <h2>게임 약속</h2>
              <Link className="secondary-link" href="/meetups/new">
                약속 만들기
              </Link>
            </div>
            <div className="meetup-list">
              {meetups.map((meetup) => {
                const joined = meetup.participants.some((participant) => participant.user.id === user.id);
                const isFull = meetup.participants.length >= meetup.maxPeople;

                return (
                  <article className="meetup-row" key={meetup.id}>
                    <div>
                      <div className="card-header compact">
                        <h3>{meetup.title}</h3>
                        <span className="badge">{meetup.participants.length}/{meetup.maxPeople}</span>
                      </div>
                      <p>
                        {meetup.game?.title ?? "게임 미정"} · {meetup.table.name} · {dateFormatter.format(meetup.startsAt)}
                      </p>
                      {meetup.description ? <p className="muted">{meetup.description}</p> : null}
                      <p className="participants">
                        {meetup.participants.map((participant) => participant.user.name).join(", ")}
                      </p>
                    </div>
                    <div className="row-actions">
                      {meetup.hostId === user.id || user.role === "ADMIN" ? (
                        <Link className="ghost-link" href={`/meetups/${meetup.id}/manage`}>
                          관리
                        </Link>
                      ) : null}
                      <form action={joined ? leaveMeetupAction : joinMeetupAction}>
                        <input type="hidden" name="meetupId" value={meetup.id} />
                        <button className={joined ? "ghost-button" : "secondary-button"} disabled={!joined && isFull}>
                          {joined ? "참여 취소" : isFull ? "마감" : "참여"}
                        </button>
                      </form>
                    </div>
                  </article>
                );
              })}
              {meetups.length === 0 ? <p className="empty">아직 잡힌 게임 약속이 없습니다.</p> : null}
            </div>
          </section>
        </div>

      </section>
    </main>
  );
}
