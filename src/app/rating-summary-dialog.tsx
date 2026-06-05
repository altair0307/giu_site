"use client";

import type { CSSProperties } from "react";
import { useEffect, useId, useState } from "react";
import { StarRating } from "@/app/star-rating";
import { getRatingReasonLabel } from "@/lib/game-rating";

type PublicRating = {
  userName: string;
  userLoginId: string;
  score: number;
  playedStatus: "VERIFIED" | "SELF_REPORTED" | "UNVERIFIED";
  reasonTags: string[];
  comment: string | null;
  updatedAtLabel: string;
};

type RatingSummaryDialogProps = {
  gameTitle: string;
  averageScore: number | null;
  ratings: PublicRating[];
};

const playedStatusLabels = {
  VERIFIED: "기록 검증됨",
  SELF_REPORTED: "해본 게임",
  UNVERIFIED: "미확인"
};

type RatingFilter = "ALL" | "HIGH" | "MID" | "LOW" | "COMMENT";
type RatingSort = "RECENT" | "HIGH" | "LOW";
const PAGE_SIZE = 10;
const RATING_METER_STEPS = 50;

function countTags(ratings: PublicRating[], type: "positive" | "negative") {
  const counts = new Map<string, number>();

  for (const rating of ratings) {
    const includeRating = type === "positive" ? rating.score >= 3 : rating.score < 4;

    if (!includeRating) {
      continue;
    }

    for (const tag of rating.reasonTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || getRatingReasonLabel(a[0]).localeCompare(getRatingReasonLabel(b[0]), "ko-KR"));
}

export function RatingSummaryDialog({ gameTitle, averageScore, ratings }: RatingSummaryDialogProps) {
  const titleId = useId();
  const tagsTitleId = useId();
  const [open, setOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [filter, setFilter] = useState<RatingFilter>("ALL");
  const [sort, setSort] = useState<RatingSort>("RECENT");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const positiveTags = countTags(ratings, "positive");
  const negativeTags = countTags(ratings, "negative");
  const filteredRatings = ratings
    .filter((rating) => {
      if (filter === "HIGH") return rating.score >= 4;
      if (filter === "MID") return rating.score >= 3 && rating.score < 4;
      if (filter === "LOW") return rating.score < 3;
      if (filter === "COMMENT") return Boolean(rating.comment);
      return true;
    })
    .sort((a, b) => {
      if (sort === "HIGH") return b.score - a.score;
      if (sort === "LOW") return a.score - b.score;
      return 0;
    });
  const visibleRatings = filteredRatings.slice(0, visibleCount);
  const averageStep = averageScore === null ? 0 : Math.round(Math.min(5, Math.max(0, averageScore)) * 10);

  function updateFilter(nextFilter: RatingFilter) {
    setFilter(nextFilter);
    setVisibleCount(PAGE_SIZE);
  }

  function updateSort(nextSort: RatingSort) {
    setSort(nextSort);
    setVisibleCount(PAGE_SIZE);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (tagsOpen) {
          setTagsOpen(false);
          return;
        }

        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
    };
  }, [open, tagsOpen]);

  return (
    <>
      <button className="ghost-button" type="button" onClick={() => setOpen(true)}>
        평점 보기
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="borrow-modal rating-modal rating-summary-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Public Rating</p>
                <h2 id={titleId}>{gameTitle}</h2>
              </div>
              <button className="modal-close-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <div className="rating-summary-content">
              <div className="rating-summary-score">
                <span>평균 평점</span>
                <div className="rating-summary-average" aria-label={averageScore === null ? "평균 평점 없음" : `평균 평점 ${averageScore.toFixed(1)}점`}>
                  <strong>{averageScore === null ? "-" : averageScore.toFixed(1)}</strong>
                  <div className="rating-summary-meter" aria-hidden="true">
                    {Array.from({ length: RATING_METER_STEPS }, (_, index) => {
                      const step = index + 1;
                      const active = step <= averageStep;

                      return (
                        <span
                          className={[
                            active ? "active" : "inactive",
                            step % 5 === 0 ? "half-step" : ""
                          ].filter(Boolean).join(" ")}
                          key={step}
                          style={{ "--meter-step": step } as CSSProperties}
                        />
                      );
                    })}
                  </div>
                  <b>5점 만점</b>
                </div>
                <small>{ratings.length}명 평가</small>
                <button className="ghost-button" type="button" onClick={() => setTagsOpen(true)}>
                  태그 모아보기
                </button>
              </div>

              <div className="rating-summary-controls">
                <div className="rating-filter-group" aria-label="평점 필터">
                  {[
                    ["ALL", "전체"],
                    ["HIGH", "4.0 이상"],
                    ["MID", "3점대"],
                    ["LOW", "3.0 미만"],
                    ["COMMENT", "설명 있음"]
                  ].map(([value, label]) => (
                    <button
                      className={filter === value ? "rating-filter-button active" : "rating-filter-button"}
                      key={value}
                      type="button"
                      onClick={() => updateFilter(value as RatingFilter)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="평점 정렬"
                  value={sort}
                  onChange={(event) => updateSort(event.currentTarget.value as RatingSort)}
                >
                  <option value="RECENT">최신순</option>
                  <option value="HIGH">높은 평점순</option>
                  <option value="LOW">낮은 평점순</option>
                </select>
              </div>

              <div className="rating-public-list">
                {visibleRatings.map((rating, index) => (
                  <article className="rating-public-row" key={`${rating.userLoginId}-${index}`}>
                    <div className="card-header compact">
                      <div className="rating-public-title">
                        <h3>
                          {rating.userName} <small>{rating.userLoginId}</small>
                        </h3>
                        <StarRating score={rating.score} />
                      </div>
                    </div>
                    <p className="muted">
                      {playedStatusLabels[rating.playedStatus]} · 수정 {rating.updatedAtLabel}
                    </p>
                    <p className="participants">이유: {rating.reasonTags.map(getRatingReasonLabel).join(", ")}</p>
                    {rating.comment ? <p className="account-rating-comment">{rating.comment}</p> : null}
                  </article>
                ))}
                {filteredRatings.length === 0 ? <p className="empty account-empty">조건에 맞는 공개 평점이 없습니다.</p> : null}
              </div>

              {visibleCount < filteredRatings.length ? (
                <button className="ghost-button rating-more-button" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                  더 보기
                </button>
              ) : null}
            </div>

            {tagsOpen ? (
              <div className="modal-backdrop rating-tags-backdrop" role="presentation" onMouseDown={() => setTagsOpen(false)}>
                <section
                  aria-labelledby={tagsTitleId}
                  aria-modal="true"
                  className="borrow-modal rating-tags-modal"
                  role="dialog"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="modal-heading">
                    <div>
                      <p className="eyebrow">Rating Tags</p>
                      <h2 id={tagsTitleId}>{gameTitle}</h2>
                    </div>
                    <button className="modal-close-button" type="button" aria-label="닫기" onClick={() => setTagsOpen(false)}>
                      ×
                    </button>
                  </div>
                  <div className="rating-summary-tags">
                    <div>
                      <strong>좋았던 점</strong>
                      <div className="rating-tag-rank-list">
                        {positiveTags.length > 0 ? (
                          positiveTags.map(([tag, count]) => (
                            <span className="rating-tag-rank" key={tag}>
                              {getRatingReasonLabel(tag)} <b>{count}</b>
                            </span>
                          ))
                        ) : (
                          <p>아직 충분한 태그가 없습니다.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <strong>아쉬운 점</strong>
                      <div className="rating-tag-rank-list">
                        {negativeTags.length > 0 ? (
                          negativeTags.map(([tag, count]) => (
                            <span className="rating-tag-rank" key={tag}>
                              {getRatingReasonLabel(tag)} <b>{count}</b>
                            </span>
                          ))
                        ) : (
                          <p>아직 충분한 태그가 없습니다.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
