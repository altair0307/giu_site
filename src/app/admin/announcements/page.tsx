import { ActionForm } from "@/app/action-form";
import { deleteAnnouncementAction, saveAnnouncementAction } from "@/app/actions";
import { prisma } from "@/lib/db";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric"
});

type AdminAnnouncementsPageProps = {
  searchParams: Promise<{
    notice?: string;
  }>;
};

function toDateTimeLocal(date: Date) {
  return date.toISOString().slice(0, 16);
}

export default async function AdminAnnouncementsPage({ searchParams }: AdminAnnouncementsPageProps) {
  const params = await searchParams;
  const announcements = await prisma.announcement.findMany({
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 30
  });

  const activeCount = announcements.filter((announcement) => announcement.isActive).length;

  return (
    <section className="admin-page">
      {params.notice === "announcement-deleted" ? <p className="notice success-notice">공지사항을 삭제했습니다.</p> : null}

      <div className="admin-summary-grid">
        <div className="admin-summary-card">
          <span>공지 수</span>
          <strong>{announcements.length}</strong>
        </div>
        <div className="admin-summary-card">
          <span>활성 공지</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="admin-summary-card">
          <span>팝업 기준</span>
          <strong>{activeCount > 0 ? "전체" : "-"}</strong>
        </div>
      </div>

      <ActionForm title="새 공지 등록" submitLabel="공지 등록" action={saveAnnouncementAction}>
        <label>
          제목
          <input name="title" placeholder="예: 개인 페이지와 반납 기능 업데이트" required />
        </label>
        <label>
          게시일
          <input name="publishedAt" type="datetime-local" defaultValue={toDateTimeLocal(new Date())} required />
        </label>
        <label className="wide">
          내용
          <textarea name="body" rows={6} placeholder="언제, 무엇이 바뀌었는지 적어주세요." required />
        </label>
        <label className="checkbox-label wide">
          <input name="isActive" type="checkbox" defaultChecked />
          팝업으로 노출
        </label>
      </ActionForm>

      <section className="section-block">
        <div className="section-heading">
          <h2>공지 목록</h2>
          <span>{announcements.length}건 표시</span>
        </div>
        <div className="announcement-admin-list">
          {announcements.map((announcement) => (
            <article className="announcement-admin-row" key={announcement.id}>
              <ActionForm title={announcement.title} submitLabel="수정 저장" action={saveAnnouncementAction}>
                <input name="id" type="hidden" value={announcement.id} />
                <label>
                  제목
                  <input name="title" defaultValue={announcement.title} required />
                </label>
                <label>
                  게시일
                  <input name="publishedAt" type="datetime-local" defaultValue={toDateTimeLocal(announcement.publishedAt)} required />
                </label>
                <label className="wide">
                  내용
                  <textarea name="body" rows={6} defaultValue={announcement.body} required />
                </label>
                <label className="checkbox-label wide">
                  <input name="isActive" type="checkbox" defaultChecked={announcement.isActive} />
                  팝업으로 노출
                </label>
              </ActionForm>
              <div className="announcement-admin-meta">
                <span className={announcement.isActive ? "badge green" : "badge"}>{announcement.isActive ? "활성" : "비활성"}</span>
                <p className="muted">게시 {dateFormatter.format(announcement.publishedAt)}</p>
                <p className="muted">수정 {dateFormatter.format(announcement.updatedAt)}</p>
                <form action={deleteAnnouncementAction}>
                  <input name="id" type="hidden" value={announcement.id} />
                  <button className="danger-button">삭제</button>
                </form>
              </div>
            </article>
          ))}
          {announcements.length === 0 ? <p className="empty account-empty">등록된 공지사항이 없습니다.</p> : null}
        </div>
      </section>
    </section>
  );
}
