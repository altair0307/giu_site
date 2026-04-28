import Link from "next/link";
import { loginAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <AuthForm mode="login" action={loginAction} />
      <p className="auth-link">
        아직 계정이 없다면 <Link href="/register">회원가입</Link>
      </p>
    </main>
  );
}
