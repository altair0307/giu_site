"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { saveGameRatingAction } from "@/app/actions";
import {
  NEGATIVE_RATING_REASON_TAGS,
  POSITIVE_RATING_REASON_TAGS,
  getRatingReasonLabel
} from "@/lib/game-rating";

type RatingDialogProps = {
  gameId: string;
  gameTitle: string;
  rating?: {
    score: number;
    playedStatus: "VERIFIED" | "SELF_REPORTED" | "UNVERIFIED";
    reasonTags: string[];
    comment: string | null;
  } | null;
};

const playedStatusLabels = {
  VERIFIED: "기록 검증됨",
  SELF_REPORTED: "해본 게임",
  UNVERIFIED: "미확인"
};

export function RatingDialog({ gameId, gameTitle, rating }: RatingDialogProps) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [score, setScore] = useState(rating?.score ?? 5);
  const showPositiveReasons = score >= 3;
  const showNegativeReasons = score < 4;

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
    };
  }, [open]);

  return (
    <>
      <button className={rating ? "ghost-button" : "secondary-button"} type="button" onClick={() => setOpen(true)}>
        {rating ? "평가 수정" : "평가"}
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="borrow-modal rating-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Rating</p>
                <h2 id={titleId}>{gameTitle}</h2>
              </div>
              <button className="modal-close-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <form
              className="borrow-modal-form"
              onSubmit={async (event) => {
                event.preventDefault();

                if (submitting) {
                  return;
                }

                setSubmitting(true);
                setError("");

                try {
                  const result = await saveGameRatingAction(new FormData(event.currentTarget));

                  if (result.message) {
                    setError(result.message);
                    return;
                  }

                  setOpen(false);
                  router.refresh();
                } catch (submitError) {
                  setError(submitError instanceof Error ? submitError.message : "평점을 저장하지 못했습니다.");
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <input type="hidden" name="gameId" value={gameId} />
              <label>
                평점
                <input
                  name="score"
                  type="number"
                  min="1"
                  max="5"
                  step="0.1"
                  defaultValue={(rating?.score ?? 5).toFixed(1)}
                  required
                  onChange={(event) => {
                    setScore(Number(event.currentTarget.value) || 1);
                  }}
                />
              </label>
              <p className="form-note">
                1.0점부터 5.0점까지 0.1점 단위로 입력할 수 있습니다. 4.0점 이상은 좋았던 이유, 3점대는 좋았던 점과 아쉬웠던 점, 3.0점 미만은 아쉬웠던 이유를 남깁니다.
              </p>

              <label className="checkbox-label rating-played-label">
                <input name="played" type="checkbox" defaultChecked={rating?.playedStatus === "VERIFIED" || rating?.playedStatus === "SELF_REPORTED"} />
                <span>해본 게임이에요</span>
              </label>

              {showPositiveReasons ? (
                <fieldset className="rating-fieldset">
                  <legend>왜 이 보드게임이 좋았나요?</legend>
                  <div className="rating-tag-grid">
                    {POSITIVE_RATING_REASON_TAGS.map((tag) => (
                      <label className="rating-tag-choice" key={`positive-${tag.value}`}>
                        <input
                          name="reasonTags"
                          type="checkbox"
                          value={tag.value}
                          defaultChecked={rating?.score === score && rating?.reasonTags.includes(tag.value)}
                        />
                        <span>{tag.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {showNegativeReasons ? (
                <fieldset className="rating-fieldset">
                  <legend>왜 이 보드게임이 아쉬웠나요?</legend>
                  <div className="rating-tag-grid">
                    {NEGATIVE_RATING_REASON_TAGS.map((tag) => (
                      <label className="rating-tag-choice" key={`negative-${tag.value}`}>
                        <input
                          name="reasonTags"
                          type="checkbox"
                          value={tag.value}
                          defaultChecked={rating?.score === score && rating?.reasonTags.includes(tag.value)}
                        />
                        <span>{tag.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <label>
                짧은 설명
                <textarea
                  name="comment"
                  rows={3}
                  defaultValue={rating?.comment ?? ""}
                  maxLength={300}
                  placeholder="선택 사항입니다."
                />
              </label>

              {rating ? (
                <p className="form-note">
                  현재 평가: {rating.score.toFixed(1)}점 · {playedStatusLabels[rating.playedStatus]} ·{" "}
                  {rating.reasonTags.map(getRatingReasonLabel).join(", ")}
                </p>
              ) : null}
              {error ? <p className="error">{error}</p> : null}

              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                  취소
                </button>
                <button className="primary-button" disabled={submitting}>
                  {submitting ? "저장 중..." : "평점 저장"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
