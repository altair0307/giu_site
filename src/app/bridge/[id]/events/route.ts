import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canViewBridgeRoom, isBridgeSpectator } from "@/lib/bridge-access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type BridgeEventsRouteProps = {
  params: Promise<{ id: string }>;
};

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 15000;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeoutId = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true }
    );
  });
}

export async function GET(request: NextRequest, { params }: BridgeEventsRouteProps) {
  const user = await getCurrentUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id: roomId } = await params;
  const room = await prisma.bridgeRoom.findUnique({
    where: { id: roomId },
    include: {
      meetup: {
        include: {
          participants: { select: { userId: true } }
        }
      }
    }
  });

  if (!room) {
    return new Response("Not found", { status: 404 });
  }

  const isParticipant = room.meetup.participants.some((participant) => participant.userId === user.id);
  const isAdmin = user.role === "ADMIN";

  if (!canViewBridgeRoom({ isParticipant, isAdmin, allowSpectators: room.allowSpectators })) {
    return new Response("Forbidden", { status: 403 });
  }

  const spectator = isBridgeSpectator({ isParticipant, isAdmin });

  const encoder = new TextEncoder();
  const sinceParam = Number(request.nextUrl.searchParams.get("since"));
  let cursorMs = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let lastHeartbeatAt = Date.now();

      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      controller.enqueue(encoder.encode(": connected\n\n"));

      while (!request.signal.aborted) {
        const events = await prisma.bridgeEvent.findMany({
          where: {
            roomId,
            createdAt: {
              gt: new Date(cursorMs)
            }
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 20
        });

        for (const event of events) {
          cursorMs = Math.max(cursorMs, event.createdAt.getTime());
          controller.enqueue(
            encoder.encode(
              `id: ${event.id}\nevent: bridge-event\ndata: ${JSON.stringify({
                id: event.id,
                type: event.type,
                payload: spectator ? null : event.payload,
                createdAt: event.createdAt.toISOString()
              })}\n\n`
            )
          );
        }

        if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeatAt = Date.now();
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }

        await wait(POLL_INTERVAL_MS, request.signal);
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
}
