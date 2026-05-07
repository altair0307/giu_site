import { addGameAction } from "@/app/actions";
import { ActionForm } from "@/app/action-form";

export default function AdminNewGamePage() {
  return (
    <section className="admin-page admin-form-page">
      <ActionForm title="게임 등록" submitLabel="게임 추가" action={addGameAction}>
        <label className="wide">
          게임명
          <input name="title" required />
        </label>
        <label>
          인원
          <input name="players" placeholder="2~4" />
        </label>
        <label>
          베스트 인원
          <input name="bestPlayers" placeholder="3~4" />
        </label>
        <label>
          시간
          <input name="playTime" placeholder="30 또는 30~60" />
        </label>
        <label>
          수량
          <input name="quantity" type="number" min="0" />
        </label>
        <label>
          장르
          <input name="genre" />
        </label>
        <label>
          존재 여부
          <select name="isPresent" defaultValue="">
            <option value="">빈칸</option>
            <option value="true">ㅇ</option>
            <option value="false">x</option>
          </select>
        </label>
        <label>
          웨이트
          <input name="weight" placeholder="1.28" />
        </label>
        <label className="wide">
          보드게임 정보 사이트
          <input name="infoUrl" type="url" placeholder="https://..." />
        </label>
        <label className="wide">
          비고
          <input name="note" />
        </label>
      </ActionForm>
    </section>
  );
}
