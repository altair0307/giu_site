import { prisma } from "@/lib/db";

type AdminGamesPageProps = {
  searchParams: Promise<{
    q?: string;
    gameNotice?: string;
    gameError?: string;
  }>;
};

export default async function AdminGamesPage({ searchParams }: AdminGamesPageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const gameEditReturnTo = `/admin/games${q ? `?${new URLSearchParams({ q }).toString()}` : ""}#game-edit`;

  const games = await prisma.game.findMany({
    where: q ? { title: { contains: q, mode: "insensitive" } } : {},
    orderBy: { title: "asc" },
    take: 20
  });

  return (
    <section className="admin-page">
      <div className="section-heading" id="game-edit">
        <h2>게임 수정</h2>
        <span>최대 20개 표시</span>
      </div>
      {params.gameNotice ? <p className="notice success-notice">{params.gameNotice}</p> : null}
      {params.gameError ? <p className="notice error-notice">{params.gameError}</p> : null}
      <form className="filter-bar admin-search-bar">
        <input name="q" defaultValue={q} placeholder="수정할 게임 검색" />
        <button className="secondary-button">검색</button>
      </form>

      <div className="admin-game-list">
        {games.map((game) => (
          <form action="/admin/games/update" method="post" className="admin-game-row" key={game.id}>
            <input type="hidden" name="id" value={game.id} />
            <input type="hidden" name="returnTo" value={gameEditReturnTo} />
            <label className="admin-game-title">
              게임명
              <input name="title" defaultValue={game.title} required />
            </label>
            <label>
              인원
              <input name="players" defaultValue={game.players ?? ""} />
            </label>
            <label>
              베스트
              <input name="bestPlayers" defaultValue={game.bestPlayers ?? ""} />
            </label>
            <label>
              시간
              <input name="playTime" defaultValue={game.playTime ?? ""} />
            </label>
            <label>
              수량
              <input name="quantity" type="number" min="0" defaultValue={game.quantity ?? ""} />
            </label>
            <label>
              장르
              <input name="genre" defaultValue={game.genre ?? ""} />
            </label>
            <label>
              존재
              <select name="isPresent" defaultValue={game.isPresent === null ? "" : game.isPresent ? "true" : "false"}>
                <option value="">빈칸</option>
                <option value="true">ㅇ</option>
                <option value="false">x</option>
              </select>
            </label>
            <label>
              웨이트
              <input name="weight" defaultValue={game.weight ?? ""} />
            </label>
            <label className="admin-game-info-url">
              정보 사이트
              <input name="infoUrl" type="url" defaultValue={game.infoUrl ?? ""} />
            </label>
            <label className="admin-game-note">
              비고
              <input name="note" defaultValue={game.note ?? ""} />
            </label>
            <button className="secondary-button">저장</button>
          </form>
        ))}
        {games.length === 0 ? <p className="empty">조건에 맞는 게임이 없습니다.</p> : null}
      </div>
    </section>
  );
}
