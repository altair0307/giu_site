import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cancelMeetupAction, completeMeetupAction, logoutAction } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short"
});

type ManageMeetupPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ManageMeetupPage({ params }: ManageMeetupPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  const meetup = await prisma.meetup.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, name: true, loginId: true } },
      game: true,
      table: true,
      participants: {
        include: { user: { select: { id: true, name: true, loginId: true, studentId: true } } },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!meetup) {
    notFound();
  }

  if (meetup.hostId !== user.id && user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Meetup</p>
          <h1>약속 관리</h1>
        </div>
        <div className="account-box">
          <Link className="ghost-link" href="/">
            대여 화면
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="manage-layout">
        <article className="panel manage-panel">
          <h2>{meetup.title}</h2>
          <p>{meetup.game?.title ?? "게임 미정"} · {meetup.table.name}</p>
          <p className="muted">{dateFormatter.format(meetup.startsAt)} · 최대 {meetup.maxPeople}명</p>
          {meetup.description ? <p>{meetup.description}</p> : null}

          <div className="danger-actions">
            <form action={completeMeetupAction}>
              <input type="hidden" name="meetupId" value={meetup.id} />
              <input type="hidden" name="returnTo" value="/" />
              <button className="secondary-button">완료하고 목록에서 제거</button>
            </form>
            <form action={cancelMeetupAction}>
              <input type="hidden" name="meetupId" value={meetup.id} />
              <input type="hidden" name="returnTo" value="/" />
              <button className="ghost-button">약속 취소</button>
            </form>
          </div>
        </article>

        <section className="panel manage-panel">
          <div className="section-heading">
            <h2>참여자</h2>
            <span>{meetup.participants.length}/{meetup.maxPeople}</span>
          </div>
          <div className="participant-list">
            {meetup.participants.map((participant) => (
              <div className="participant-row" key={participant.id}>
                <strong>{participant.user.name}</strong>
                <span>{participant.user.loginId}{participant.user.studentId ? ` · ${participant.user.studentId}` : ""}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
