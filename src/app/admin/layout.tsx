import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";

const adminLinks = [
  { href: "/admin", label: "승인 대기" },
  { href: "/admin/logs", label: "운영 로그" },
  { href: "/admin/loans", label: "대여 관리" },
  { href: "/admin/users", label: "회원 관리" },
  { href: "/admin/meetups", label: "약속 관리" },
  { href: "/admin/games", label: "게임 수정" },
  { href: "/admin/games/new", label: "게임 등록" },
  { href: "/admin/games/import", label: "엑셀 업로드" }
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <main className="app-shell">
      <header className="topbar admin-topbar">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>관리자 데이터 관리</h1>
        </div>
        <div className="account-box">
          <Link className="ghost-link" href="/">
            사용자 화면
          </Link>
          <form action={logoutAction}>
            <button className="ghost-button">로그아웃</button>
          </form>
        </div>
      </header>

      <nav className="admin-nav" aria-label="관리자 메뉴">
        {adminLinks.map((link) => (
          <Link className="admin-nav-link" href={link.href} key={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>

      {children}
    </main>
  );
}
