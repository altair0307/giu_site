import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppFrame } from "@/app/app-frame";
import { AdminNav } from "@/app/admin/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <AppFrame title="관리자 승인 관리" user={user} admin>

      <AdminNav />

      {children}
    </AppFrame>
  );
}
