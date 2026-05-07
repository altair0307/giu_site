"use client";

export default function GlobalError({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body>
        <main className="error-shell">
          <section className="panel error-panel">
            <p className="eyebrow">Error</p>
            <h1>페이지를 다시 불러와주세요</h1>
            <p className="muted">일시적인 오류가 발생했습니다. 새로고침 후에도 계속되면 잠시 뒤 다시 시도해주세요.</p>
            <button className="primary-button" type="button" onClick={() => reset()}>
              다시 시도
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
