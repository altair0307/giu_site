import Link from "next/link";
import { redirect } from "next/navigation";
import {
  addGameAction,
  approveLoanRequestAction,
  cancelMeetupAction,
  completeMeetupAction,
  importGamesAction,
  rejectLoanRequestAction,
  logoutAction,
  resetUserPasswordAction,
  updateGameFormAction,
  updateUserFormAction
} from "@/app/actions";
import { ActionForm } from "@/app/action-form";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

type AdminPageProps = {
  searchParams: Promise<{
    q?: string;
    userQ?: string;
    notice?: string;
  }>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    redirect("/");
  }

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const userQ = (params.userQ ?? "").trim();
  const notice = params.notice;
  const [games, users, meetups, loanRequests] = await Promise.all([
    prisma.game.findMany({
      where: q ? { title: { contains: q, mode: "insensitive" } } : {},
      orderBy: { title: "asc" },
      take: 80
    }),
    prisma.user.findMany({
      where: userQ
        ? {
            OR: [
              { loginId: { contains: userQ, mode: "insensitive" } },
              { name: { contains: userQ, mode: "insensitive" } },
              { studentId: { contains: userQ, mode: "insensitive" } }
            ]
          }
        : {},
      orderBy: [{ role: "desc" }, { createdAt: "desc" }],
      take: 80
    }),
    prisma.meetup.findMany({
      where: { startsAt: { gte: new Date() } },
      include: {
        host: { select: { name: true, loginId: true } },
        game: true,
        table: true,
        participants: true
      },
      orderBy: { startsAt: "asc" },
      take: 80
    }),
    prisma.loanRequest.findMany({
      where: { status: "PENDING" },
      include: {
        game: true,
        requester: { select: { name: true, loginId: true, studentId: true } },
        loan: {
          include: {
            borrower: { select: { name: true, loginId: true, studentId: true } }
          }
        }
      },
      orderBy: { requestedAt: "asc" },
      take: 80
    })
  ]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>관리자 데이터 관리</h1>
        </div>
        <div className="account-box">
          <Link className="ghost-link" href="/">
            사용자 화면
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="content-grid admin-layout">
        <aside className="side-column">
          <ActionForm title="엑셀 업로드" submitLabel="DB 반영" action={importGamesAction}>
            <label className="wide">
              보드게임 명단 파일
              <input name="file" type="file" accept=".xlsx" required />
            </label>
            <p className="form-note wide">소유자 열은 제외하고, 빈칸은 빈칸으로 저장합니다.</p>
            <a className="secondary-link wide" href="/admin/games/export">
              현재 DB 내려받기
            </a>
          </ActionForm>

          <ActionForm title="게임 등록" submitLabel="게임 추가" action={addGameAction}>
            <label className="wide">
              게임명
              <input name="title" required />
            </label>
            <label>
              인원
              <input name="players" placeholder="2~4" />
            </label>
            <label>
              베스트 인원
              <input name="bestPlayers" placeholder="3~4" />
            </label>
            <label>
              시간
              <input name="playTime" placeholder="30 또는 30~60" />
            </label>
            <label>
              수량
              <input name="quantity" type="number" min="0" />
            </label>
            <label>
              장르
              <input name="genre" />
            </label>
            <label>
              존재 여부
              <select name="isPresent" defaultValue="">
                <option value="">빈칸</option>
                <option value="true">ㅇ</option>
                <option value="false">x</option>
              </select>
            </label>
            <label>
              웨이트
              <input name="weight" placeholder="1.28" />
            </label>
            <label className="wide">
              비고
              <input name="note" />
            </label>
          </ActionForm>
        </aside>

        <section className="main-column section-block">
          {notice === "password-reset" ? (
            <p className="notice success-notice">비밀번호가 1981로 초기화되었습니다.</p>
          ) : null}
          {notice === "user-deleted" ? (
            <p className="notice success-notice">사용자를 삭제했습니다.</p>
          ) : null}

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

          <div className="section-heading">
            <h2>회원 관리</h2>
            <span>{users.length}명 표시</span>
          </div>
          <form className="filter-bar admin-search-bar">
            <input type="hidden" name="q" value={q} />
            <input name="userQ" defaultValue={userQ} placeholder="아이디, 이름, 학번 검색" />
            <button className="secondary-button">검색</button>
          </form>

          <div className="admin-user-list">
            {users.map((member) => (
              <article className="admin-user-row" key={member.id}>
                <form action={updateUserFormAction} className="admin-user-edit">
                  <input type="hidden" name="id" value={member.id} />
                  <label>
                    아이디
                    <input value={member.loginId} readOnly />
                  </label>
                  <label>
                    이름
                    <input name="name" defaultValue={member.name} required />
                  </label>
                  <label>
                    학번
                    <input name="studentId" defaultValue={member.studentId ?? ""} />
                  </label>
                  <label>
                    권한
                    <select name="role" defaultValue={member.role}>
                      <option value="MEMBER">일반 사용자</option>
                      <option value="ADMIN">관리자</option>
                    </select>
                  </label>
                  <button className="secondary-button">저장</button>
                </form>
                <form action={resetUserPasswordAction}>
                  <input type="hidden" name="id" value={member.id} />
                  <button className="ghost-button">1981 초기화</button>
                </form>
                <Link className="danger-link" href={`/admin/users/${member.id}/delete`}>
                  삭제
                </Link>
              </article>
            ))}
          </div>

          <div className="section-heading">
            <h2>약속 관리</h2>
            <span>{meetups.length}개 예정</span>
          </div>
          <div className="admin-meetup-list">
            {meetups.map((meetup) => (
              <article className="admin-meetup-row" key={meetup.id}>
                <div>
                  <strong>{meetup.title}</strong>
                  <p className="muted">
                    {meetup.game?.title ?? "게임 미정"} · {meetup.table.name} · {meetup.host.name} 개최 · {meetup.participants.length}/{meetup.maxPeople}
                  </p>
                </div>
                <div className="row-actions">
                  <Link className="ghost-link" href={`/meetups/${meetup.id}/manage`}>
                    상세
                  </Link>
                  <form action={completeMeetupAction}>
                    <input type="hidden" name="meetupId" value={meetup.id} />
                    <input type="hidden" name="returnTo" value="/admin" />
                    <button className="secondary-button">완료</button>
                  </form>
                  <form action={cancelMeetupAction}>
                    <input type="hidden" name="meetupId" value={meetup.id} />
                    <input type="hidden" name="returnTo" value="/admin" />
                    <button className="ghost-button">취소</button>
                  </form>
                </div>
              </article>
            ))}
            {meetups.length === 0 ? <p className="empty">예정된 게임 약속이 없습니다.</p> : null}
          </div>

          <div className="section-heading">
            <h2>게임 수정</h2>
            <span>최대 80개 표시</span>
          </div>
          <form className="filter-bar">
            <input name="q" defaultValue={q} placeholder="수정할 게임 검색" />
            <button className="secondary-button">검색</button>
          </form>

          <div className="admin-game-list">
            {games.map((game) => (
              <form action={updateGameFormAction} className="admin-game-row" key={game.id}>
                <input type="hidden" name="id" value={game.id} />
                <label>
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
                <label>
                  비고
                  <input name="note" defaultValue={game.note ?? ""} />
                </label>
                <button className="secondary-button">저장</button>
              </form>
            ))}
            {games.length === 0 ? <p className="empty">조건에 맞는 게임이 없습니다.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
