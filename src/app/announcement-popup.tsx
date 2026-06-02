"use client";

import { useEffect, useId, useState } from "react";

type AnnouncementPopupProps = {
  announcements: {
    id: string;
    title: string;
    body: string;
    publishedAt: string;
    publishedAtLabel: string;
  }[];
};

export function AnnouncementPopup({ announcements }: AnnouncementPopupProps) {
  const [open, setOpen] = useState(false);
  const [hideForDay, setHideForDay] = useState(false);
  const titleId = useId();
  const announcementKey = announcements.map((announcement) => announcement.id).join(":");

  useEffect(() => {
    if (announcements.length === 0 || !announcementKey) {
      return;
    }

    const storageKey = `announcements:${announcementKey}:hiddenUntil`;
    const hiddenUntil = Number(window.localStorage.getItem(storageKey) ?? 0);

    if (!hiddenUntil || hiddenUntil <= Date.now()) {
      window.localStorage.removeItem(storageKey);
      setOpen(true);
    }
  }, [announcements.length, announcementKey]);

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

  if (announcements.length === 0 || !open) {
    return null;
  }

  const close = () => {
    if (hideForDay) {
      window.localStorage.setItem(`announcements:${announcementKey}:hiddenUntil`, String(Date.now() + 24 * 60 * 60 * 1000));
    }

    setOpen(false);
  };

  return (
    <div className="modal-backdrop announcement-backdrop" role="presentation" onMouseDown={close}>
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="borrow-modal announcement-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Notice</p>
            <h2 id={titleId}>공지사항</h2>
          </div>
          <button className="modal-close-button" type="button" aria-label="공지 닫기" onClick={close}>
            ×
          </button>
        </div>
        <div className="announcement-content">
          <div className="announcement-popup-list">
            {announcements.map((announcement) => (
              <article className="announcement-popup-item" key={announcement.id}>
                <time className="muted" dateTime={announcement.publishedAt}>
                  {announcement.publishedAtLabel}
                </time>
                <h3>{announcement.title}</h3>
                <p>{announcement.body}</p>
              </article>
            ))}
          </div>
          <label className="checkbox-label announcement-hide-option">
            <input
              type="checkbox"
              checked={hideForDay}
              onChange={(event) => setHideForDay(event.currentTarget.checked)}
            />
            하루간 보지 않기
          </label>
          <button className="primary-button" type="button" onClick={close}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}
