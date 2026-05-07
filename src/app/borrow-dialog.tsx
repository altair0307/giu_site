"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { borrowGameAction, returnGameAction } from "@/app/actions";

const MAX_PHOTO_SIZE = 8 * 1024 * 1024;
const TARGET_PHOTO_SIZE = 1400 * 1024;
const MAX_PHOTO_DIMENSION = 1600;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  note?: string;
  submitLabel: string;
  pendingLabel: string;
};

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 불러오지 못했습니다."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("사진을 압축하지 못했습니다."));
      },
      "image/jpeg",
      quality
    );
  });
}

async function preparePhoto(file: File) {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    throw new Error("사진은 JPG, PNG, WebP 형식만 업로드할 수 있습니다.");
  }

  if (file.size <= TARGET_PHOTO_SIZE) {
    return file;
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("사진을 처리하지 못했습니다.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let blob = await canvasToBlob(canvas, 0.82);

  for (const quality of [0.72, 0.62, 0.52]) {
    if (blob.size <= TARGET_PHOTO_SIZE) {
      break;
    }

    blob = await canvasToBlob(canvas, quality);
  }

  if (blob.size > MAX_PHOTO_SIZE) {
    throw new Error("사진 용량을 줄이지 못했습니다. 조금 더 낮은 화질로 다시 촬영해주세요.");
  }

  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

function PhotoActionDialog({
  action,
  hiddenInputName,
  hiddenInputValue,
  triggerLabel,
  eyebrow,
  title,
  fieldLabel,
  note,
  submitLabel,
  pendingLabel
}: PhotoDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

            <form
              className="borrow-modal-form"
              onSubmit={async (event) => {
                event.preventDefault();

                if (!photo || processing || submitting) {
                  return;
                }

                setSubmitting(true);
                setFileError("");

                try {
                  const formData = new FormData();
                  formData.set(hiddenInputName, hiddenInputValue);
                  formData.set("photo", photo);
                  await action(formData);
                  setOpen(false);
                  setPhoto(null);
                  setFileStatus("");
                  router.refresh();
                } catch (error) {
                  setFileError(error instanceof Error ? error.message : "처리에 실패했습니다.");
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <label>
                {fieldLabel}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  required
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];

                    if (!file) {
                      setPhoto(null);
                      setFileError("");
                      setFileStatus("");
                      return;
                    }

                    setProcessing(true);
                    setPhoto(null);
                    setFileError("");
                    setFileStatus(file.size > TARGET_PHOTO_SIZE ? "사진 용량을 줄이는 중입니다..." : "");

                    try {
                      const preparedPhoto = await preparePhoto(file);
                      setPhoto(preparedPhoto);
                      setFileStatus(
                        preparedPhoto.size < file.size
                          ? `사진을 ${(preparedPhoto.size / 1024 / 1024).toFixed(1)}MB로 줄였습니다.`
                          : ""
                      );
                    } catch (error) {
                      event.currentTarget.value = "";
                      setPhoto(null);
                      setFileStatus("");
                      setFileError(error instanceof Error ? error.message : "사진을 처리하지 못했습니다.");
                    } finally {
                      setProcessing(false);
                    }
                  }}
                />
              </label>
              {fileError ? <p className="error">{fileError}</p> : null}
              {fileStatus ? <p className="success">{fileStatus}</p> : null}
              {note ? <p className="notice warning-notice modal-notice">{note}</p> : null}
              <p className="form-note">큰 사진은 자동으로 용량을 줄여 업로드합니다.</p>
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
                  취소
                </button>
                <button className="primary-button" disabled={!photo || processing || submitting}>
                  {processing ? "사진 준비 중..." : submitting ? pendingLabel : submitLabel}
                </button>
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
      note="대여기간은 승인 시점부터 최대 7일입니다."
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
