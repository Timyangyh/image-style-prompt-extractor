import { useEffect } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "summary",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export function useDialogAccessibility(activeDialogKey: string): void {
  useEffect(() => {
    if (!activeDialogKey) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("modal-open");

    const activeDialog = () => {
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
      );
      return dialogs[dialogs.length - 1] || null;
    };

    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = activeDialog();
      if (!dialog || dialog.contains(document.activeElement)) return;
      const autofocusTarget = dialog.querySelector<HTMLElement>("[autofocus]");
      const firstTarget = dialog.querySelector<HTMLElement>(focusableSelector);
      (autofocusTarget || firstTarget || dialog).focus();
    });

    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = activeDialog();
      if (!dialog) return;
      const targets = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (target) => target.getClientRects().length > 0
      );
      if (!targets.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", containFocus, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", containFocus, true);
      document.body.classList.remove("modal-open");
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [activeDialogKey]);
}
