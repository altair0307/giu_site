import { redirect } from "next/navigation";
import { changePasswordAction, logoutAction } from "@/app/actions";
import { AuthForm } from "@/app/auth-form";
import { getCurrentUser } from "@/lib/auth";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="auth-shell">
      <form action={logoutAction} className="auth-top-action">
        <button className="ghost-button">로그아웃</button>
      </form>
      <AuthForm mode="change-password" action={changePasswordAction} />
    </main>
  );
}
