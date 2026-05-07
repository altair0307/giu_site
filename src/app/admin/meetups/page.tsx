import Link from "next/link";
import { cancelMeetupAction, completeMeetupAction } from "@/app/actions";
import { prisma } from "@/lib/db";

export default async function AdminMeetupsPage() {
  const meetups = await prisma.meetup.findMany({
    where: { startsAt: { gte: new Date() } },
    include: {
      host: { select: { name: true, loginId: true } },
      game: true,
      table: true,
      participants: true
    },
    orderBy: { startsAt: "asc" },
    take: 80
  });

  return (
    <section className="admin-page">
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
                {meetup.game?.title ?? "게임 미정"} · {meetup.table.name} · {meetup.host.name} 개최 ·{" "}
                {meetup.participants.length}/{meetup.maxPeople}
              </p>
            </div>
            <div className="row-actions">
              <Link className="ghost-link" href={`/meetups/${meetup.id}/manage`}>
                상세
              </Link>
              <form action={completeMeetupAction}>
                <input type="hidden" name="meetupId" value={meetup.id} />
                <input type="hidden" name="returnTo" value="/admin/meetups" />
                <button className="secondary-button">완료</button>
              </form>
              <form action={cancelMeetupAction}>
                <input type="hidden" name="meetupId" value={meetup.id} />
                <input type="hidden" name="returnTo" value="/admin/meetups" />
                <button className="ghost-button">취소</button>
              </form>
            </div>
          </article>
        ))}
        {meetups.length === 0 ? <p className="empty">예정된 게임 약속이 없습니다.</p> : null}
      </div>
    </section>
  );
}
