"use client";

import { useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { borrowGameAction, returnGameAction } from "@/app/actions";

type BorrowDialogProps = {
  gameId: string;
  gameTitle: string;
};

type ReturnDialogProps = {
  loanId: string;
  gameTitle: string;
};

type PhotoDialogProps = {
  action: (formData: FormData) => Promise<void>;
  hiddenInputName: "gameId" | "loanId";
  hiddenInputValue: string;
  triggerLabel: string;
  eyebrow: string;
  title: string;
  fieldLabel: string;
  submitLabel: string;
  pendingLabel: string;
};

function PhotoSubmitButton({
  hasPhoto,
  pendingLabel,
  submitLabel
}: {
  hasPhoto: boolean;
  pendingLabel: string;
  submitLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" disabled={pending || !hasPhoto}>
      {pending ? pendingLabel : submitLabel}
    </button>
  );
}

function PhotoActionDialog({
  action,
  hiddenInputName,
  hiddenInputValue,
  triggerLabel,
  eyebrow,
  title,
  fieldLabel,
  submitLabel,
  pendingLabel
}: PhotoDialogProps) {
  const [open, setOpen] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
    };
  }, [open]);

  return (
    <>
      <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="borrow-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{eyebrow}</p>
                <h2 id={titleId}>{title}</h2>
              </div>
              <button className="modal-close-button" type="button" aria-label="닫기" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <form action={action} className="borrow-modal-form">
              <input type="hidden" name={hiddenInputName} value={hiddenInputValue} />
              <label>
                {fieldLabel}
                <input
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  required
                  onChange={(event) => setHasPhoto((event.currentTarget.files?.length ?? 0) > 0)}
                />
              </label>
              <p className="form-note">JPG, PNG, WebP 형식으로 1MB 이하의 사진을 올려주세요.</p>
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                  취소
                </button>
                <PhotoSubmitButton hasPhoto={hasPhoto} pendingLabel={pendingLabel} submitLabel={submitLabel} />
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function BorrowDialog({ gameId, gameTitle }: BorrowDialogProps) {
  return (
    <PhotoActionDialog
      action={borrowGameAction}
      hiddenInputName="gameId"
      hiddenInputValue={gameId}
      triggerLabel="대여"
      eyebrow="Borrow"
      title={gameTitle}
      fieldLabel="대여 전 게임 사진"
      submitLabel="사진 업로드 후 대여 완료"
      pendingLabel="대여 처리 중..."
    />
  );
}

export function ReturnDialog({ loanId, gameTitle }: ReturnDialogProps) {
  return (
    <PhotoActionDialog
      action={returnGameAction}
      hiddenInputName="loanId"
      hiddenInputValue={loanId}
      triggerLabel="반납"
      eyebrow="Return"
      title={gameTitle}
      fieldLabel="반납 전 게임 사진"
      submitLabel="사진 업로드 후 반납 요청"
      pendingLabel="반납 요청 중..."
    />
  );
}
