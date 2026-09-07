"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDots,
  ClipboardText,
  GearSix,
  HouseLine,
  SignOut,
  UserCircle
} from "@phosphor-icons/react";
import { logoutAction } from "@/app/actions";

type AppFrameProps = {
  children: React.ReactNode;
  title: string;
  user: { name: string; loginId: string; role: string };
  admin?: boolean;
  loanStatus?: { monthly: number; monthlyLimit: number; active: number };
};

const primaryLinks = [
  { href: "/", label: "대여", icon: HouseLine },
  { href: "/meetups/new", label: "약속", icon: CalendarDots },
  { href: "/account", label: "내 대여", icon: ClipboardText }
];

export function AppFrame({ children, title, user, admin = false, loanStatus }: AppFrameProps) {
  const pathname = usePathname();
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <main className="product-shell">
      <header className="mobile-product-header">
        <Link className="mobile-brand" href="/" aria-label="GIU 보드게임 홈">GIU</Link>
        <Link className="mobile-account-link" href="/account" aria-label="내 페이지">
          <UserCircle size={22} />
          <span>{user.name}</span>
        </Link>
      </header>
      <aside className="product-sidebar">
        <Link className="brand-lockup" href="/" aria-label="GIU 보드게임 홈">
          <strong>GIU</strong>
          <span>보드게임</span>
        </Link>
        <nav className="side-nav" aria-label="주요 메뉴">
          {primaryLinks.map(({ href, label, icon: Icon }) => (
            <Link className={isActive(href) && !admin ? "side-nav-link active" : "side-nav-link"} href={href} key={href}>
              <Icon size={20} weight={isActive(href) ? "fill" : "regular"} />
              {label}
            </Link>
          ))}
        </nav>
        {user.role === "ADMIN" ? (
          <nav className="side-nav side-nav-admin" aria-label="관리자 메뉴">
            <Link className={admin ? "side-nav-link active" : "side-nav-link"} href="/admin">
              <GearSix size={20} weight={admin ? "fill" : "regular"} />
              관리자
            </Link>
          </nav>
        ) : null}
      </aside>

      <div className="product-main">
        <header className="product-topbar">
          <h1>{title}</h1>
          <div className="product-account-area">
            <div className="product-account">
              <span className="account-name">{user.name}{user.role === "ADMIN" ? "(관리자)" : ""}</span>
              <Link href="/account"><UserCircle size={19} />내 페이지</Link>
              <form action={logoutAction}>
                <button><SignOut size={19} />로그아웃</button>
              </form>
            </div>
            {loanStatus ? (
              <div className="loan-status-strip">
                <span>월 대여 <strong>{loanStatus.monthly}/{loanStatus.monthlyLimit}</strong></span>
                <progress value={loanStatus.monthly} max={loanStatus.monthlyLimit} />
                <span>현재 대여 <strong>{loanStatus.active}개</strong></span>
              </div>
            ) : null}
          </div>
        </header>
        {children}
      </div>

      <nav className="mobile-bottom-nav" aria-label="모바일 주요 메뉴">
        {primaryLinks.map(({ href, label, icon: Icon }) => (
          <Link
            aria-current={isActive(href) && !admin ? "page" : undefined}
            className={isActive(href) && !admin ? "active" : ""}
            href={href}
            key={href}
          >
            <Icon size={21} weight={isActive(href) && !admin ? "fill" : "regular"} />
            <span>{label}</span>
          </Link>
        ))}
        {user.role === "ADMIN" ? (
          <Link aria-current={admin ? "page" : undefined} className={admin ? "active" : ""} href="/admin">
            <GearSix size={21} weight={admin ? "fill" : "regular"} />
            <span>관리자</span>
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
