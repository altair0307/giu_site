export function canViewBridgeRoom({
  isParticipant,
  isAdmin,
  allowSpectators
}: {
  isParticipant: boolean;
  isAdmin: boolean;
  allowSpectators: boolean;
}) {
  return isParticipant || isAdmin || allowSpectators;
}

export function isBridgeSpectator({
  isParticipant,
  isAdmin
}: {
  isParticipant: boolean;
  isAdmin: boolean;
}) {
  return !isParticipant && !isAdmin;
}
