import type { Prisma } from "@prisma/client";

export async function removeMeetupParticipant(
  tx: Prisma.TransactionClient,
  input: {
    meetupId: string;
    targetUserId: string;
    actor: { id: string; role?: string | null };
  }
) {
  const meetup = await tx.meetup.findUnique({
    where: { id: input.meetupId },
    include: {
      bridgeRoom: {
        include: {
          seats: true,
          deals: { select: { id: true }, take: 1 }
        }
      },
      participants: true
    }
  });

  if (!meetup) {
    throw new Error("약속을 찾을 수 없습니다.");
  }

  const isSelf = input.actor.id === input.targetUserId;
  const canManage = meetup.hostId === input.actor.id || input.actor.role === "ADMIN";

  if (!isSelf && !canManage) {
    throw new Error("방장 또는 관리자만 참여자를 내보낼 수 있습니다.");
  }

  if (input.targetUserId === meetup.hostId) {
    throw new Error("방장은 방에서 나가거나 내보낼 수 없습니다.");
  }

  if (meetup.kind === "BRIDGE" && (meetup.bridgeRoom?.deals.length ?? 0) > 0) {
    throw new Error("이미 딜이 시작된 브릿지 약속에서는 나갈 수 없습니다.");
  }

  const bridgeRoomId = meetup.bridgeRoom?.id ?? null;
  const leavingSeat = bridgeRoomId
    ? await tx.bridgeSeat.findFirst({
        where: { roomId: bridgeRoomId, userId: input.targetUserId },
        select: { position: true }
      })
    : null;

  await tx.meetupParticipant.deleteMany({
    where: { meetupId: input.meetupId, userId: input.targetUserId }
  });

  if (bridgeRoomId) {
    await tx.bridgeSeat.deleteMany({
      where: { roomId: bridgeRoomId, userId: input.targetUserId }
    });

    if (leavingSeat || !isSelf) {
      await tx.bridgeEvent.create({
        data: {
          roomId: bridgeRoomId,
          type: "SEAT_LEFT",
          actorId: input.actor.id,
          payload: {
            position: leavingSeat?.position ?? null,
            userId: input.targetUserId
          }
        }
      });
    }
  }

  return bridgeRoomId;
}
