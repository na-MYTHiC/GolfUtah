"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The panel that slides up from the bottom, shared so every one of them
 * looks and behaves the same.
 *
 * Lifted out of the rounds sheet when a second one arrived. Two sheets
 * built separately drift — a radius here, a padding there — and the app
 * stops feeling like one thing. Same reason the close button, the
 * backdrop and the scroll lock live here rather than in each caller.
 *
 * Rendered through a portal at the end of <body>. Both callers live in
 * the sticky header, which has a backdrop-blur, and a backdrop-filter
 * makes its element the containing block for fixed-position descendants:
 * `fixed inset-0` stops meaning "the viewport" and clips to the header.
 * A portal steps out of that entirely, which is the only fix that keeps
 * the blur.
 *
 * No mounted guard needed: a sheet only exists once its button has been
 * pressed, which cannot happen during a static prerender.
 */
export function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // Callers pass an inline closure, which is a new function every render.
  // Held in a ref so the effect below runs once per opening rather than
  // tearing down and re-locking the page on each render.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Body scroll would otherwise run on underneath the open sheet.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div data-sheet className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-surface-1 ring-1 ring-line"
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface-1 px-4 py-3">
          <div>
            <h2 className="text-[1.0625rem] font-semibold text-text-1">{title}</h2>
            {subtitle && <p className="text-[0.6875rem] text-text-3">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-m-2 p-2 text-lg text-text-3"
          >
            ✕
          </button>
        </div>

        {children}
      </div>
    </div>,
    document.body
  );
}
