import Link from "next/link";
import { registerAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="GIU 보드게임 소개">
        <Link className="auth-brand" href="/">GIU <span>보드게임</span></Link>
        <div><p>GIU BOARDGAME CLUB</p><h2>새로운 테이블에<br />함께 앉아보세요.</h2><span>회원으로 참여해 게임을 빌리고 다음 모임을 직접 만들어보세요.</span></div>
      </section>
      <section className="auth-form-area"><div>
        <AuthForm mode="register" action={registerAction} />
        <p className="auth-link">이미 계정이 있다면 <Link href="/login">로그인</Link></p>
      </div></section>
    </main>
  );
}
