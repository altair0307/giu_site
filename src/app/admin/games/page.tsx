import { prisma } from "@/lib/db";

type AdminGamesPageProps = {
  searchParams: Promise<{
    q?: string;
    category?: string;
    owner?: string;
    gameNotice?: string;
    gameError?: string;
  }>;
};

export default async function AdminGamesPage({ searchParams }: AdminGamesPageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const category = (params.category ?? "").trim();
  const owner = (params.owner ?? "").trim();
  const returnParams = new URLSearchParams();

  if (q) returnParams.set("q", q);
  if (category) returnParams.set("category", category);
  if (owner) returnParams.set("owner", owner);

  const gameEditReturnTo = `/admin/games${returnParams.size ? `?${returnParams.toString()}` : ""}#game-edit`;

  const games = await prisma.game.findMany({
    where: {
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
      ...(category ? { genre: { contains: category, mode: "insensitive" as const } } : {}),
      ...(owner ? { owner: { contains: owner, mode: "insensitive" as const } } : {})
    },
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
        <input name="q" defaultValue={q} placeholder="게임명 검색" />
        <input name="category" defaultValue={category} placeholder="카테고리(장르) 검색" />
        <input name="owner" defaultValue={owner} placeholder="소유자 검색" />
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
              소유자
              <input name="owner" defaultValue={game.owner ?? ""} />
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
            <label>
              대여
              <select name="isLoanEnabled" defaultValue={game.isLoanEnabled ? "true" : "false"}>
                <option value="true">활성화</option>
                <option value="false">비활성화</option>
              </select>
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
