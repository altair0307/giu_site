import { updateLoanPolicyAction } from "@/app/actions";
import { ActionForm } from "@/app/action-form";
import { getLoanPolicy } from "@/lib/loan-policy";

export default async function AdminSettingsPage() {
  const policy = await getLoanPolicy();

  return (
    <section className="admin-page admin-form-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Loan policy</p>
          <h2>대여 설정</h2>
        </div>
      </div>

      <ActionForm title="회원 대여 제한" submitLabel="대여 제한 저장" action={updateLoanPolicyAction}>
        <label>
          회원당 최대 동시 대여 개수
          <input
            name="maxActiveLoansPerUser"
            type="number"
            min="1"
            max="100"
            defaultValue={policy.maxActiveLoansPerUser}
            required
          />
        </label>
        <label>
          회원당 월 최대 대여 횟수
          <input name="maxLoansPerMonth" type="number" min="1" max="1000" defaultValue={policy.maxLoansPerMonth} required />
        </label>
        <label>
          최대 대여 기간(일)
          <input name="loanPeriodDays" type="number" min="1" max="365" defaultValue={policy.loanPeriodDays} required />
        </label>
        <p className="form-note wide">
          변경한 제한은 새로 생성되는 대여부터 적용됩니다. 이미 대여 중인 건의 반납 예정일은 바뀌지 않습니다.
        </p>
      </ActionForm>
    </section>
  );
}
