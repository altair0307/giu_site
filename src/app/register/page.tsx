import Link from "next/link";
import { registerAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <AuthForm mode="register" action={registerAction} />
      <p className="auth-link">
        이미 계정이 있다면 <Link href="/login">로그인</Link>
      </p>
    </main>
  );
}
