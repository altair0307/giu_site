import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  cancelMeetupWithAlertAction,
  completeMeetupAction,
  createBridgeRoomAction,
  leaveMeetupWithAlertAction,
  logoutAction,
  removeMeetupParticipantAction
} from "@/app/actions";
import { BridgeActionForm } from "@/app/bridge/[id]/bridge-action-form";
import { MeetupAccessSync } from "@/app/meetups/[id]/meetup-access-sync";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createKoreaDateFormatter } from "@/lib/date-time";

const dateFormatter = createKoreaDateFormatter({
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
      bridgeRoom: {
        select: {
          id: true,
          status: true,
          deals: { select: { id: true }, take: 1 }
        }
      },
      participants: {
        include: { user: { select: { id: true, name: true, loginId: true, studentId: true } } },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!meetup) {
    notFound();
  }

  const isParticipant = meetup.participants.some((participant) => participant.user.id === user.id);
  const canManageMeetup = meetup.hostId === user.id || user.role === "ADMIN";
  const bridgeDealHasStarted = (meetup.bridgeRoom?.deals.length ?? 0) > 0;
  const canLeaveMeetup = isParticipant && meetup.hostId !== user.id && !bridgeDealHasStarted;

  if (!isParticipant && !canManageMeetup) {
    redirect("/");
  }

  return (
    <main className="app-shell">
      <MeetupAccessSync />
      <header className="topbar">
        <div>
          <p className="eyebrow">Meetup</p>
          <h1>{canManageMeetup ? "약속 관리" : "약속 상세"}</h1>
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
          <p>{meetup.kind === "BRIDGE" ? "컨트랙트 브릿지" : meetup.game?.title ?? "게임 미정"} · {meetup.table.name}</p>
          <p className="muted">{dateFormatter.format(meetup.startsAt)} · 최대 {meetup.maxPeople}명</p>
          {meetup.description ? <p>{meetup.description}</p> : null}

          {meetup.kind === "BRIDGE" && canManageMeetup ? (
            <div className="bridge-actions">
              {meetup.bridgeRoom ? (
                <Link className="title-link" href={`/bridge/${meetup.bridgeRoom.id}`}>
                  {meetup.bridgeRoom.status === "COMPLETED" ? "브릿지 결과 보기" : meetup.title}
                </Link>
              ) : (
                <form action={createBridgeRoomAction}>
                  <input type="hidden" name="meetupId" value={meetup.id} />
                  <button className="secondary-button">
                    브릿지 테이블 열기
                  </button>
                </form>
              )}
              <p className="form-note">
                {meetup.bridgeRoom?.status === "COMPLETED"
                  ? "종료된 브릿지 세션은 결과 화면으로 남습니다."
                  : "브릿지 방은 바로 열 수 있고, 참여자 4명이 모이면 딜을 생성할 수 있습니다."}
              </p>
            </div>
          ) : null}

          {canManageMeetup ? (
            <div className="danger-actions">
              <form action={completeMeetupAction}>
                <input type="hidden" name="meetupId" value={meetup.id} />
                <input type="hidden" name="returnTo" value="/" />
                <button className="secondary-button">{meetup.kind === "BRIDGE" ? "세션 종료" : "완료하고 목록에서 제거"}</button>
              </form>
              <BridgeActionForm action={cancelMeetupWithAlertAction}>
                <input type="hidden" name="meetupId" value={meetup.id} />
                <input type="hidden" name="returnTo" value="/" />
                <button className="ghost-button">약속 취소</button>
              </BridgeActionForm>
            </div>
          ) : null}
          {canLeaveMeetup ? (
            <BridgeActionForm className="danger-actions" action={leaveMeetupWithAlertAction}>
              <input type="hidden" name="meetupId" value={meetup.id} />
              <input type="hidden" name="returnTo" value="/" />
              <button className="ghost-button">약속 나가기</button>
            </BridgeActionForm>
          ) : null}
        </article>

        <section className="panel manage-panel">
          <div className="section-heading">
            <h2>참여자</h2>
            <span>{meetup.participants.length}/{meetup.maxPeople}</span>
          </div>
          <div className="participant-list">
            {meetup.participants.map((participant) => (
              <div className="participant-row" key={participant.id}>
                <div>
                  <strong>{participant.user.name}</strong>
                  <span>{participant.user.loginId}{participant.user.studentId ? ` · ${participant.user.studentId}` : ""}</span>
                </div>
                {canManageMeetup && participant.user.id !== meetup.hostId && !bridgeDealHasStarted ? (
                  <BridgeActionForm action={removeMeetupParticipantAction}>
                    <input type="hidden" name="meetupId" value={meetup.id} />
                    <input type="hidden" name="userId" value={participant.user.id} />
                    <button className="ghost-button">내보내기</button>
                  </BridgeActionForm>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
