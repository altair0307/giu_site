"use client";

import { useActionState, useEffect } from "react";
import type { ActionState } from "@/app/actions";

type BridgeActionFormProps = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
};

export function BridgeActionForm({ action, children, className }: BridgeActionFormProps) {
  const [state, formAction] = useActionState(action, {});

  useEffect(() => {
    if (state.message) {
      window.alert(state.message);
    }

    if (state.redirectTo) {
      window.location.href = state.redirectTo;
    }
  }, [state]);

  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  );
}
