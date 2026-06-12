"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type MeetupAccessSyncProps = {
  intervalMs?: number;
};

export function MeetupAccessSync({ intervalMs = 2500 }: MeetupAccessSyncProps) {
  const router = useRouter();

  useEffect(() => {
    const refreshMeetup = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const intervalId = window.setInterval(refreshMeetup, intervalMs);
    document.addEventListener("visibilitychange", refreshMeetup);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshMeetup);
    };
  }, [intervalMs, router]);

  return null;
}
