import "server-only";

import { headers } from "next/headers";

export async function getClientKey(action: string) {
  const headerStore = await headers();
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip");
  return `${action}:${forwardedFor || realIp || "local"}`;
}
