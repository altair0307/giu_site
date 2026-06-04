export const POSITIVE_RATING_REASON_TAGS = [
  { value: "strategy", label: "전략이 좋았음" },
  { value: "theme", label: "테마가 좋았음" },
  { value: "easy_rules", label: "룰이 쉬웠음" },
  { value: "short_play", label: "플레이타임이 적당함" },
  { value: "interaction", label: "상호작용이 좋았음" },
  { value: "party", label: "파티성이 좋았음" },
  { value: "replayable", label: "리플레이성이 좋았음" }
] as const;

export const NEGATIVE_RATING_REASON_TAGS = [
  { value: "luck_issue", label: "운 요소가 아쉬움" },
  { value: "too_hard", label: "너무 어려움" },
  { value: "too_long", label: "너무 김" },
  { value: "downtime", label: "기다리는 시간이 김" }
] as const;

export const RATING_REASON_TAGS = [...POSITIVE_RATING_REASON_TAGS, ...NEGATIVE_RATING_REASON_TAGS] as const;

export const POSITIVE_RATING_REASON_VALUES: ReadonlySet<string> = new Set(POSITIVE_RATING_REASON_TAGS.map((tag) => tag.value));
export const NEGATIVE_RATING_REASON_VALUES: ReadonlySet<string> = new Set(NEGATIVE_RATING_REASON_TAGS.map((tag) => tag.value));
export const RATING_REASON_VALUES: ReadonlySet<string> = new Set(RATING_REASON_TAGS.map((tag) => tag.value));

export function getRatingReasonLabel(value: string) {
  return RATING_REASON_TAGS.find((tag) => tag.value === value)?.label ?? value;
}
