"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";

type ActionFormProps = {
  title: string;
  children: React.ReactNode;
  submitLabel: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
};

export function ActionForm({ title, children, submitLabel, action }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="panel form-panel">
      <h2>{title}</h2>
      <div className="form-grid">{children}</div>
      {state.message ? <p className={state.ok ? "success" : "error"}>{state.message}</p> : null}
      <button className="primary-button" disabled={pending}>
        {pending ? "저장 중..." : submitLabel}
      </button>
    </form>
  );
}
