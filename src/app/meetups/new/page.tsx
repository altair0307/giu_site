import Link from "next/link";
import { redirect } from "next/navigation";
import { createMeetupAction, logoutAction } from "@/app/actions";
import { ActionForm } from "@/app/action-form";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatKoreaDateTimeLocal } from "@/lib/date-time";

const GAME_PICKER_SIZE = 12;

type NewMeetupPageProps = {
  searchParams: Promise<{
    gameQ?: string;
    page?: string;
  }>;
};

export default async function NewMeetupPage({ searchParams }: NewMeetupPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const gameQ = (params.gameQ ?? "").trim();
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const now = new Date();
  const nowInputValue = formatKoreaDateTimeLocal(now);
  const gameWhere = {
    status: "AVAILABLE" as const,
    meetups: {
      none: {
        startsAt: { gte: now }
      }
    },
    ...(gameQ ? { title: { contains: gameQ, mode: "insensitive" as const } } : {})
  };
  const shouldSearchGames = gameQ.length > 0;

  const [games, gameTotal, tables] = await Promise.all([
    shouldSearchGames
      ? prisma.game.findMany({
          where: gameWhere,
          orderBy: { title: "asc" },
          skip: (page - 1) * GAME_PICKER_SIZE,
          take: GAME_PICKER_SIZE
        })
      : Promise.resolve([]),
    shouldSearchGames ? prisma.game.count({ where: gameWhere }) : Promise.resolve(0),
    prisma.gameTable.findMany({ orderBy: { capacity: "asc" } })
  ]);

  const totalPages = Math.max(1, Math.ceil(gameTotal / GAME_PICKER_SIZE));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Meetup</p>
          <h1>게임 약속 만들기</h1>
        </div>
        <div className="account-box">
          <span>
            {user.name} <small>{user.loginId}</small>
          </span>
          <Link className="ghost-link" href="/">
            대여 화면
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="meetup-create-layout">
        <ActionForm title="약속 정보" submitLabel="약속 등록" action={createMeetupAction}>
          <fieldset className="wide segmented-field">
            <legend>약속 종류</legend>
            <label>
              <input type="radio" name="kind" value="GENERAL" defaultChecked />
              <span>
                <strong>일반 게임</strong>
                <small>보드게임 약속을 만들고 참여자를 모집합니다.</small>
              </span>
            </label>
            <label>
              <input type="radio" name="kind" value="BRIDGE" />
              <span>
                <strong>컨트랙트 브릿지</strong>
                <small>4명이 모이면 브릿지 테이블을 열 수 있습니다.</small>
              </span>
            </label>
          </fieldset>
          <label className="wide">
            제목
            <input name="title" placeholder="오늘 저녁 스플렌더" required />
          </label>
          <label>
            테이블
            <select name="tableId" required>
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name} · {table.capacity}명
                </option>
              ))}
            </select>
          </label>
          <label>
            시작 시간
            <input name="startsAt" type="datetime-local" defaultValue={nowInputValue} required />
            <span className="field-hint">브릿지 약속은 현재 시간으로 바로 만들어도 됩니다.</span>
          </label>
          <label>
            최대 인원
            <input name="maxPeople" type="number" min="2" max="30" defaultValue="4" required />
            <span className="field-hint">브릿지 약속은 저장 시 4명으로 고정됩니다.</span>
          </label>
          <label className="wide">
            설명
            <textarea name="description" rows={4} placeholder="초보 환영, 룰 설명 가능" />
          </label>

          <div className="wide game-picker">
            <div className="section-heading">
              <h2>게임 선택</h2>
              <span>{shouldSearchGames ? `${gameTotal}개 검색됨` : "검색 후 선택"}</span>
            </div>
            <label className="game-choice empty-choice">
              <input type="radio" name="gameId" value="" defaultChecked />
              <span>
                <strong>게임 미정</strong>
                <small>나중에 댓글이나 현장에서 정할 때 사용</small>
              </span>
            </label>
            {games.map((game) => (
              <label className="game-choice" key={game.id}>
                <input type="radio" name="gameId" value={game.id} />
                <span>
                  <strong>{game.title}</strong>
                  <small>
                    {[game.players, game.bestPlayers ? `베스트 ${game.bestPlayers}` : "", game.playTime ? `${game.playTime}분` : "", game.genre, game.weight ? `웨이트 ${game.weight}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </label>
            ))}
            {!shouldSearchGames ? <p className="empty">게임명을 검색하면 대여 가능한 게임만 표시됩니다.</p> : null}
            {shouldSearchGames && games.length === 0 ? (
              <p className="empty">대여 중이거나 이미 예정된 약속이 있는 게임은 표시되지 않습니다.</p>
            ) : null}
          </div>
        </ActionForm>

        <aside className="panel finder-panel">
          <h2>게임 찾기</h2>
          <form className="finder-form">
            <input name="gameQ" defaultValue={gameQ} placeholder="게임명 검색" />
            <button className="secondary-button">검색</button>
          </form>
          <div className="pager">
            <Link
              className={page <= 1 ? "pager-link disabled" : "pager-link"}
              href={`/meetups/new?gameQ=${encodeURIComponent(gameQ)}&page=${Math.max(1, page - 1)}`}
            >
              이전
            </Link>
            <span className="pager-status">{page}/{totalPages}</span>
            <Link
              className={page >= totalPages ? "pager-link disabled" : "pager-link"}
              href={`/meetups/new?gameQ=${encodeURIComponent(gameQ)}&page=${Math.min(totalPages, page + 1)}`}
            >
              다음
            </Link>
          </div>
        </aside>
      </section>
    </main>
  );
}
