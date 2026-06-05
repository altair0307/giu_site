type StarRatingProps = {
  score: number;
  label?: string;
  className?: string;
};

export function StarRating({ score, label, className }: StarRatingProps) {
  const clampedScore = Math.min(5, Math.max(0, score));
  const width = `${(clampedScore / 5) * 100}%`;

  return (
    <span className={className ? `star-rating ${className}` : "star-rating"} aria-label={`${label ? `${label} ` : ""}${score.toFixed(1)}점`}>
      {label ? <span className="star-rating-label">{label}</span> : null}
      <span className="star-rating-stars" aria-hidden="true">
        <span className="star-rating-empty">★★★★★</span>
        <span className="star-rating-fill" style={{ width }}>
          ★★★★★
        </span>
      </span>
      <span className="star-rating-score">{score.toFixed(1)}</span>
    </span>
  );
}
