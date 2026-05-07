import { importGamesAction } from "@/app/actions";
import { ActionForm } from "@/app/action-form";

export default function AdminImportGamesPage() {
  return (
    <section className="admin-page admin-form-page">
      <ActionForm title="엑셀 업로드" submitLabel="DB 반영" action={importGamesAction}>
        <label className="wide">
          보드게임 명단 파일
          <input name="file" type="file" accept=".xlsx" required />
        </label>
        <p className="form-note wide">소유자 열은 제외하고, 빈칸은 빈칸으로 저장합니다.</p>
        <a className="secondary-link wide" href="/admin/games/export">
          현재 DB 내려받기
        </a>
      </ActionForm>
    </section>
  );
}
