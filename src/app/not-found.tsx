import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-shell">
      <section className="panel error-panel">
        <p className="eyebrow">404</p>
        <h1>페이지를 찾을 수 없습니다</h1>
        <p className="muted">주소가 잘못되었거나, 삭제되었거나, 더 이상 접근할 수 없는 페이지입니다.</p>
        <Link className="primary-button error-action" href="/">
          홈으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
