import Link from "next/link";
import { loginAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="GIU 보드게임 소개">
        <Link className="auth-brand" href="/">GIU <span>보드게임</span></Link>
        <div><p>GIU BOARDGAME CLUB</p><h2>좋아하는 게임과<br />사람을 한곳에서.</h2><span>대여부터 약속, 브릿지 테이블까지 동아리의 모든 플레이를 이어갑니다.</span></div>
      </section>
      <section className="auth-form-area"><div>
        <AuthForm mode="login" action={loginAction} />
        <p className="auth-link">아직 계정이 없다면 <Link href="/register">회원가입</Link></p>
      </div></section>
    </main>
  );
}
