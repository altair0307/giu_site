export const BRIDGE_LOBBY_EXPIRY_MS = 30 * 60 * 1000;
export const BRIDGE_PLAYING_EXPIRY_MS = 3 * 60 * 60 * 1000;

export type ExpirableBridgeRoomStatus = "LOBBY" | "PLAYING";

export function bridgeRoomExpiryMs(status: ExpirableBridgeRoomStatus) {
  return status === "LOBBY" ? BRIDGE_LOBBY_EXPIRY_MS : BRIDGE_PLAYING_EXPIRY_MS;
}

export function bridgeRoomExpiresAt(status: ExpirableBridgeRoomStatus, lastActivityAt: Date) {
  return new Date(lastActivityAt.getTime() + bridgeRoomExpiryMs(status));
}

export function isBridgeRoomExpired(status: ExpirableBridgeRoomStatus, lastActivityAt: Date, now = new Date()) {
  return bridgeRoomExpiresAt(status, lastActivityAt).getTime() <= now.getTime();
}

export function latestBridgeActivityAt(roomUpdatedAt: Date, latestEventAt?: Date | null) {
  if (!latestEventAt || roomUpdatedAt.getTime() >= latestEventAt.getTime()) {
    return roomUpdatedAt;
  }

  return latestEventAt;
}
