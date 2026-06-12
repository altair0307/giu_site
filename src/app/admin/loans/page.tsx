import Link from "next/link";
import { deleteLoanAction } from "@/app/actions";
import { prisma } from "@/lib/db";
import { createKoreaDateFormatter } from "@/lib/date-time";

const dateFormatter = createKoreaDateFormatter({
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

type AdminLoansPageProps = {
  searchParams: Promise<{
    notice?: string;
  }>;
};

export default async function AdminLoansPage({ searchParams }: AdminLoansPageProps) {
  const params = await searchParams;
  const loans = await prisma.loan.findMany({
    where: { status: "ACTIVE" },
    include: {
      game: true,
      borrower: {
        select: {
          name: true,
          loginId: true,
          studentId: true
        }
      },
      photos: {
        orderBy: { createdAt: "asc" }
      },
      requests: {
        orderBy: { requestedAt: "desc" },
        take: 3
      }
    },
    orderBy: { borrowedAt: "desc" },
    take: 120
  });

  return (
    <section className="admin-page">
      {params.notice === "loan-deleted" ? <p className="notice success-notice">대여 기록을 삭제했습니다.</p> : null}

      <div className="section-heading">
        <h2>대여 관리</h2>
        <span>{loans.length}건 표시</span>
      </div>

      <div className="admin-loan-list">
        {loans.map((loan) => {
          const borrowPhoto = loan.photos.find((photo) => photo.type === "BORROW");
          const returnPhotos = loan.photos.filter((photo) => photo.type === "RETURN");

          return (
            <article className="admin-loan-row" key={loan.id}>
              <div>
                <strong>{loan.game.title}</strong>
                <p className="muted">
                  {loan.borrower.name}({loan.borrower.loginId}
                  {loan.borrower.studentId ? ` · ${loan.borrower.studentId}` : ""}) ·{" "}
                  대여 중 · 대여 {dateFormatter.format(loan.borrowedAt)} · 반납 예정 {dateFormatter.format(loan.dueAt)}
                </p>

                <div className="loan-photo-grid">
                  {borrowPhoto ? (
                    <Link className="photo-preview-link" href={`/loan-photos/${borrowPhoto.id}`} target="_blank">
                      <img alt={`${loan.game.title} 대여 사진`} src={`/loan-photos/${borrowPhoto.id}`} />
                      <span>대여 사진</span>
                    </Link>
                  ) : null}
                  {returnPhotos.map((photo, index) => (
                    <Link className="photo-preview-link" href={`/loan-photos/${photo.id}`} target="_blank" key={photo.id}>
                      <img alt={`${loan.game.title} 반납 사진 ${index + 1}`} src={`/loan-photos/${photo.id}`} />
                      <span>반납 사진 {index + 1}</span>
                    </Link>
                  ))}
                  {loan.photos.length === 0 ? <span className="muted">저장된 사진 없음</span> : null}
                </div>
              </div>

              <div className="row-actions">
                {loan.requests.some((request) => request.type === "RETURN" && request.status === "PENDING") ? (
                  <Link className="secondary-link" href="/admin">
                    반납 승인으로 이동
                  </Link>
                ) : null}
                <form action={deleteLoanAction}>
                  <input type="hidden" name="loanId" value={loan.id} />
                  <button className="danger-button">대여 삭제</button>
                </form>
              </div>
            </article>
          );
        })}
        {loans.length === 0 ? <p className="empty">대여 기록이 없습니다.</p> : null}
      </div>
    </section>
  );
}
