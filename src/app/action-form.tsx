"use client";

import { Children, useActionState, useState } from "react";
import type { ActionState } from "@/app/actions";

type ActionFormProps = {
  title: string;
  children: React.ReactNode;
  submitLabel: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  wizard?: boolean;
};

export function ActionForm({ title, children, submitLabel, action, wizard = false }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [step, setStep] = useState(1);
  const items = Children.toArray(children);
  const mainFields = wizard ? items.slice(0, -1) : items;
  const picker = wizard ? items.slice(-1) : [];

  return (
    <form action={formAction} className="panel form-panel">
      <h2>{wizard ? step === 1 ? "기본 정보" : step === 2 ? "게임 선택" : "입력 내용 확인" : title}</h2>
      {wizard ? (
        <div className="form-steps" aria-label="약속 만들기 진행 단계">
          {["기본 정보", "게임 선택", "확인"].map((label, index) => (
            <span className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""} key={label}><i>{index + 1}</i>{label}</span>
          ))}
        </div>
      ) : null}
      <div className={wizard && step !== 1 ? "form-grid wizard-hidden" : "form-grid"}>{mainFields}</div>
      {wizard ? <div className={step !== 2 ? "form-grid wizard-hidden" : "form-grid"}>{picker}</div> : null}
      {wizard && step === 3 ? <div className="wizard-confirm"><strong>약속 정보를 확인해주세요.</strong><p>이전 단계에서 입력한 기본 정보와 게임 선택으로 약속을 등록합니다.</p></div> : null}
      {state.message ? <p className={state.ok ? "success" : "error"}>{state.message}</p> : null}
      {wizard ? <div className="wizard-actions">
        <button className="ghost-button" type="button" disabled={step === 1 || pending} onClick={() => setStep((current) => Math.max(1, current - 1))}>이전</button>
        {step < 3 ? <button className="primary-button" type="button" onClick={() => setStep((current) => Math.min(3, current + 1))}>다음</button> : <button className="primary-button" disabled={pending}>{pending ? "저장 중..." : submitLabel}</button>}
      </div> : <button className="primary-button" disabled={pending}>{pending ? "저장 중..." : submitLabel}</button>}
    </form>
  );
}
