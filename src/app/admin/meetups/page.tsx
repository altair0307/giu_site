import Link from "next/link";
import { cancelMeetupWithAlertAction, completeMeetupAction, expireBridgeRoomAction } from "@/app/actions";
import { BridgeActionForm } from "@/app/bridge/[id]/bridge-action-form";
import { bridgeRoomExpiresAt, isBridgeRoomExpired, latestBridgeActivityAt } from "@/lib/bridge-expiration";
import { calculateBridgeSessionScore } from "@/lib/bridge-results";
import { prisma } from "@/lib/db";
import { createKoreaDateFormatter } from "@/lib/date-time";

const dateFormatter = createKoreaDateFormatter({
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export default async function AdminMeetupsPage() {
  const now = new Date();
  const [meetups, historicalBridgeRooms] = await Promise.all([
    prisma.meetup.findMany({
      where: {
        OR: [
          { kind: "GENERAL", startsAt: { gte: new Date() } },
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
        bridgeRoom: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            events: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 }
          }
        },
        participants: true
      },
      orderBy: { startsAt: "asc" },
      take: 80
    }),
    prisma.bridgeRoom.findMany({
      where: { status: { in: ["COMPLETED", "EXPIRED"] } },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        meetup: {
          select: {
            title: true,
            host: { select: { name: true, loginId: true } },
            table: { select: { name: true } },
            participants: { select: { id: true } }
          }
        },
        deals: {
          where: { completedAt: { not: null } },
          select: { declarer: true, score: true },
          orderBy: { boardNumber: "asc" }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 40
    })
  ]);

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
          const lastActivityAt = meetup.bridgeRoom
            ? latestBridgeActivityAt(meetup.bridgeRoom.updatedAt, meetup.bridgeRoom.events[0]?.createdAt)
            : null;
          const expiresAt =
            meetup.bridgeRoom && (meetup.bridgeRoom.status === "LOBBY" || meetup.bridgeRoom.status === "PLAYING") && lastActivityAt
              ? bridgeRoomExpiresAt(meetup.bridgeRoom.status, lastActivityAt)
              : null;
          const canExpire =
            meetup.bridgeRoom &&
            (meetup.bridgeRoom.status === "LOBBY" || meetup.bridgeRoom.status === "PLAYING") &&
            lastActivityAt &&
            isBridgeRoomExpired(meetup.bridgeRoom.status, lastActivityAt, now);

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
              {expiresAt ? (
                <p className="muted">
                  마지막 활동 {dateFormatter.format(lastActivityAt!)} · 만료 기준 {dateFormatter.format(expiresAt)}
                </p>
              ) : null}
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
              {canExpire && meetup.bridgeRoom ? (
                <BridgeActionForm action={expireBridgeRoomAction}>
                  <input type="hidden" name="roomId" value={meetup.bridgeRoom.id} />
                  <button className="ghost-button">만료 처리</button>
                </BridgeActionForm>
              ) : null}
            </div>
          </article>
          );
        })}
        {meetups.length === 0 ? <p className="empty">예정된 게임 약속이 없습니다.</p> : null}
      </div>

      <div className="section-heading">
        <h2>최근 종료 브릿지 세션</h2>
        <span>{historicalBridgeRooms.length}개</span>
      </div>
      <div className="admin-meetup-list">
        {historicalBridgeRooms.map((room) => {
          const score = calculateBridgeSessionScore(room.deals);

          return (
            <article className="admin-meetup-row" key={room.id}>
              <div>
                <div className="card-header compact">
                  <strong>
                    <Link className="title-link" href={`/bridge/${room.id}`}>
                      {room.meetup.title}
                    </Link>
                  </strong>
                  <span className="badge green">브릿지</span>
                  <span className={room.status === "EXPIRED" ? "badge amber" : "badge"}>{room.status}</span>
                </div>
                <p className="muted">
                  {room.meetup.table.name} · {room.meetup.host.name} 개최 · {room.meetup.participants.length}명 · {room.deals.length}보드 · NS {score.ns} · EW {score.ew} · 종료 {dateFormatter.format(room.updatedAt)}
                </p>
              </div>
              <Link className="secondary-link" href={`/bridge/${room.id}`}>
                결과 보기
              </Link>
            </article>
          );
        })}
        {historicalBridgeRooms.length === 0 ? <p className="empty">종료된 브릿지 세션이 없습니다.</p> : null}
      </div>
    </section>
  );
}
