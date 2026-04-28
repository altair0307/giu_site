"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";

type AuthFormProps = {
  mode: "login" | "register" | "change-password";
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
};

export function AuthForm({ mode, action }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const isRegister = mode === "register";
  const isPasswordChange = mode === "change-password";

  return (
    <form action={formAction} className="panel auth-panel">
      <div>
        <p className="eyebrow">Boardgame Club</p>
        <h1>{isPasswordChange ? "비밀번호 변경" : isRegister ? "회원가입" : "로그인"}</h1>
      </div>

      {isRegister ? (
        <label>
          이름
          <input name="name" autoComplete="name" required />
        </label>
      ) : null}

      {!isPasswordChange ? (
        <label>
          아이디
          <input name="loginId" autoComplete="username" required />
        </label>
      ) : null}

      {isRegister ? (
        <label>
          학번
          <input name="studentId" autoComplete="off" />
        </label>
      ) : null}

      <label>
        비밀번호
        <input name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} required />
      </label>

      {isRegister || isPasswordChange ? (
        <label>
          비밀번호 확인
          <input name="passwordConfirm" type="password" autoComplete="new-password" required />
        </label>
      ) : null}

      {state.message ? <p className={state.ok ? "success" : "error"}>{state.message}</p> : null}

      <button className="primary-button" disabled={pending}>
        {pending ? "처리 중..." : isPasswordChange ? "새 비밀번호 저장" : isRegister ? "가입하기" : "로그인"}
      </button>
    </form>
  );
}
