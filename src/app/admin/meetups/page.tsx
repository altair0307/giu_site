import Link from "next/link";
import { cancelMeetupWithAlertAction, completeMeetupAction } from "@/app/actions";
import { BridgeActionForm } from "@/app/bridge/[id]/bridge-action-form";
import { prisma } from "@/lib/db";

export default async function AdminMeetupsPage() {
  const meetups = await prisma.meetup.findMany({
    where: {
      OR: [
        { startsAt: { gte: new Date() } },
        {
          kind: "BRIDGE",
          bridgeRoom: {
            is: {
              status: { in: ["LOBBY", "PLAYING"] }
            }
          }
        }
      ]
    },
    include: {
      host: { select: { name: true, loginId: true } },
      game: true,
      table: true,
      bridgeRoom: { select: { id: true, status: true } },
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
        {meetups.map((meetup) => {
          const meetupHref = meetup.bridgeRoom ? `/bridge/${meetup.bridgeRoom.id}` : `/meetups/${meetup.id}/manage`;
          const bridgeRoomStatus = meetup.bridgeRoom?.status ?? null;

          return (
          <article className="admin-meetup-row" key={meetup.id}>
            <div>
              <div className="card-header compact">
                <strong>
                  <Link className="title-link" href={meetupHref}>
                    {meetup.title}
                  </Link>
                </strong>
                {meetup.kind === "BRIDGE" ? <span className="badge green">브릿지</span> : null}
                {bridgeRoomStatus ? <span className="badge">{bridgeRoomStatus}</span> : null}
              </div>
              <p className="muted">
                {meetup.kind === "BRIDGE" ? "컨트랙트 브릿지" : meetup.game?.title ?? "게임 미정"} · {meetup.table.name} · {meetup.host.name} 개최 ·{" "}
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
                <button className="secondary-button">{meetup.kind === "BRIDGE" ? "세션 종료" : "완료"}</button>
              </form>
              <BridgeActionForm action={cancelMeetupWithAlertAction}>
                <input type="hidden" name="meetupId" value={meetup.id} />
                <input type="hidden" name="returnTo" value="/admin/meetups" />
                <button className="ghost-button">취소</button>
              </BridgeActionForm>
            </div>
          </article>
          );
        })}
        {meetups.length === 0 ? <p className="empty">예정된 게임 약속이 없습니다.</p> : null}
      </div>
    </section>
  );
}
