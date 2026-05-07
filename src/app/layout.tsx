import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "동아리방 보드게임",
  description: "보드게임 대여와 게임 약속을 관리하는 동아리 사이트"
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
