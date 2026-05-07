import Link from "next/link";
import { resetUserPasswordAction, updateUserFormAction } from "@/app/actions";
import { prisma } from "@/lib/db";

type AdminUsersPageProps = {
  searchParams: Promise<{
    userQ?: string;
    notice?: string;
  }>;
};

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const userQ = (params.userQ ?? "").trim();

  const users = await prisma.user.findMany({
    where: userQ
      ? {
          OR: [
            { loginId: { contains: userQ, mode: "insensitive" } },
            { name: { contains: userQ, mode: "insensitive" } },
            { studentId: { contains: userQ, mode: "insensitive" } }
          ]
        }
      : {},
    orderBy: [{ role: "desc" }, { createdAt: "desc" }],
    take: 80
  });

  return (
    <section className="admin-page">
      {params.notice === "password-reset" ? (
        <p className="notice success-notice">비밀번호가 1981로 초기화되었습니다.</p>
      ) : null}
      {params.notice === "user-deleted" ? <p className="notice success-notice">사용자를 삭제했습니다.</p> : null}

      <div className="section-heading">
        <h2>회원 관리</h2>
        <span>{users.length}명 표시</span>
      </div>
      <form className="filter-bar admin-search-bar">
        <input name="userQ" defaultValue={userQ} placeholder="아이디, 이름, 학번 검색" />
        <button className="secondary-button">검색</button>
      </form>

      <div className="admin-user-list">
        {users.map((member) => (
          <article className="admin-user-row" key={member.id}>
            <form action={updateUserFormAction} className="admin-user-edit">
              <input type="hidden" name="id" value={member.id} />
              <label>
                아이디
                <input value={member.loginId} readOnly />
              </label>
              <label>
                이름
                <input name="name" defaultValue={member.name} required />
              </label>
              <label>
                학번
                <input name="studentId" defaultValue={member.studentId ?? ""} />
              </label>
              <label>
                권한
                <select name="role" defaultValue={member.role}>
                  <option value="MEMBER">일반 사용자</option>
                  <option value="ADMIN">관리자</option>
                </select>
              </label>
              <button className="secondary-button">저장</button>
            </form>
            <div className="row-actions">
              <form action={resetUserPasswordAction}>
                <input type="hidden" name="id" value={member.id} />
                <button className="ghost-button">1981 초기화</button>
              </form>
              <Link className="danger-link" href={`/admin/users/${member.id}/delete`}>
                삭제
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
