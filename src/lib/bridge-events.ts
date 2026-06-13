import type { Prisma } from "@prisma/client";

export const BRIDGE_EVENT_RETENTION_COUNT = 500;

export async function pruneBridgeEvents(
  tx: Prisma.TransactionClient,
  roomId: string,
  keepCount = BRIDGE_EVENT_RETENTION_COUNT
) {
  const staleEvents = await tx.bridgeEvent.findMany({
    where: { roomId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: keepCount,
    take: 1000,
    select: { id: true }
  });

  if (staleEvents.length === 0) {
    return 0;
  }

  const result = await tx.bridgeEvent.deleteMany({
    where: { id: { in: staleEvents.map((event) => event.id) } }
  });

  return result.count;
}
