"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminLinks = [
  { href: "/admin", label: "승인 대기" },
  { href: "/admin/logs", label: "운영 로그" },
  { href: "/admin/loans", label: "대여 관리" },
  { href: "/admin/settings", label: "대여 설정" },
  { href: "/admin/users", label: "회원 관리" },
  { href: "/admin/announcements", label: "공지 관리" },
  { href: "/admin/meetups", label: "약속 관리" },
  { href: "/admin/games", label: "게임 수정" },
  { href: "/admin/games/new", label: "게임 등록" },
  { href: "/admin/games/import", label: "엑셀 업로드" }
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="관리자 메뉴">
      {adminLinks.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return <Link aria-current={active ? "page" : undefined} className={active ? "admin-nav-link active" : "admin-nav-link"} href={link.href} key={link.href}>{link.label}</Link>;
      })}
    </nav>
  );
}
