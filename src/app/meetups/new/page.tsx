import Link from "next/link";
import { redirect } from "next/navigation";
import { createMeetupAction, logoutAction } from "@/app/actions";
import { ActionForm } from "@/app/action-form";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  const gameWhere = gameQ ? { title: { contains: gameQ, mode: "insensitive" as const } } : {};

  const [games, gameTotal, tables] = await Promise.all([
    prisma.game.findMany({
      where: gameWhere,
      orderBy: { title: "asc" },
      skip: (page - 1) * GAME_PICKER_SIZE,
      take: GAME_PICKER_SIZE
    }),
    prisma.game.count({ where: gameWhere }),
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
            <input name="startsAt" type="datetime-local" required />
          </label>
          <label>
            최대 인원
            <input name="maxPeople" type="number" min="2" max="30" defaultValue="4" required />
          </label>
          <label className="wide">
            설명
            <textarea name="description" rows={4} placeholder="초보 환영, 룰 설명 가능" />
          </label>

          <div className="wide game-picker">
            <div className="section-heading">
              <h2>게임 선택</h2>
              <span>{gameTotal}개 검색됨</span>
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
