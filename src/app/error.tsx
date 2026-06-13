"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="error-shell">
      <section className="panel error-panel">
        <p className="eyebrow">Error</p>
        <h1>요청을 처리하지 못했습니다</h1>
        <p className="muted">잠시 후 다시 시도해주세요. 같은 문제가 계속되면 홈으로 돌아가 다시 시작할 수 있습니다.</p>
        <div className="error-actions">
          <button className="primary-button" type="button" onClick={() => reset()}>
            다시 시도
          </button>
          <Link className="ghost-link" href="/">
            홈으로 이동
          </Link>
        </div>
      </section>
    </main>
  );
}
