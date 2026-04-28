import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { deleteUserAction, logoutAction } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type DeleteUserPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DeleteUserPage({ params }: DeleteUserPageProps) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }

  if (currentUser.role !== "ADMIN") {
    redirect("/");
  }

  const { id } = await params;
  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      loginId: true,
      name: true,
      studentId: true,
      role: true
    }
  });

  if (!targetUser) {
    notFound();
  }

  const isSelf = targetUser.id === currentUser.id;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>사용자 삭제</h1>
        </div>
        <div className="account-box">
          <Link className="ghost-link" href="/admin">
            관리자 화면
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <section className="panel delete-panel">
        <h2>{targetUser.name}</h2>
        <p className="muted">
          {targetUser.loginId}
          {targetUser.studentId ? ` · ${targetUser.studentId}` : ""} · {targetUser.role === "ADMIN" ? "관리자" : "일반 사용자"}
        </p>
        <p>
          삭제하면 이 사용자의 세션, 대여 기록, 참여 기록, 개최한 약속이 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
        </p>

        {isSelf ? (
          <p className="error">본인 계정은 삭제할 수 없습니다.</p>
        ) : (
          <form action={deleteUserAction} className="delete-form">
            <input type="hidden" name="id" value={targetUser.id} />
            <label>
              삭제하려면 DELETE를 입력하세요
              <input name="confirm" required />
            </label>
            <div className="danger-actions">
              <button className="danger-button">사용자 삭제</button>
              <Link className="ghost-link" href="/admin">
                취소
              </Link>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
