"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type BridgeRoomSyncProps = {
  roomId: string;
  currentUserId: string;
  intervalMs?: number;
};

type BridgeEventMessage = {
  type?: string;
  payload?: {
    userId?: string;
  } | null;
};

export function BridgeRoomSync({ roomId, currentUserId, intervalMs = 2500 }: BridgeRoomSyncProps) {
  const router = useRouter();

  useEffect(() => {
    const refreshRoom = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const intervalId = window.setInterval(refreshRoom, intervalMs);
    document.addEventListener("visibilitychange", refreshRoom);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshRoom);
    };
  }, [intervalMs, router]);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const source = new EventSource(`/bridge/${roomId}/events?since=${Date.now()}`);
    const handleBridgeEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      let data: BridgeEventMessage | null = null;

      try {
        data = JSON.parse(message.data) as BridgeEventMessage;
      } catch {
        data = null;
      }

      if (data?.type === "SEAT_LEFT" && data.payload?.userId === currentUserId) {
        window.location.href = "/";
        return;
      }

      router.refresh();
    };

    source.addEventListener("bridge-event", handleBridgeEvent);

    return () => {
      source.removeEventListener("bridge-event", handleBridgeEvent);
      source.close();
    };
  }, [currentUserId, roomId, router]);

  return null;
}
