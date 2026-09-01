import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, description, children, className }: ModalProps) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);

  const generatedTitleId = React.useId();
  const generatedDescId = React.useId();
  const titleId = title ? generatedTitleId : undefined;
  const descriptionId = description ? generatedDescId : undefined;

  // Capture trigger focus on open, and restore focus on close
  React.useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = (document.activeElement as HTMLElement) || null;
    } else {
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        try {
          if (document.body.contains(previousActiveElementRef.current)) {
            previousActiveElementRef.current.focus();
          }
        } catch {
          // Ignore if trigger is unmounted or disconnected
        }
      }
      previousActiveElementRef.current = null;
    }
  }, [isOpen]);

  // Initial focus, focus trap (Tab / Shift+Tab) and Escape key handler
  React.useEffect(() => {
    if (!isOpen) return;

    const getFocusableElements = (): HTMLElement[] => {
      if (!dialogRef.current) return [];
      const selector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const elements = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(selector));
      return elements.filter((el) => {
        return el.offsetParent !== null || el.getAttribute("aria-hidden") !== "true";
      });
    };

    // Move initial focus into modal
    const focusTimer = setTimeout(() => {
      if (!dialogRef.current) return;
      if (!dialogRef.current.contains(document.activeElement)) {
        const focusable = getFocusableElements();
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab") {
        const focusable = getFocusableElements();
        if (focusable.length === 0) {
          e.preventDefault();
          if (dialogRef.current) dialogRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === dialogRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Always open with the body scrolled to the TOP — before first paint, and
  // again on the next frames: on real mobile devices an autofocused input or
  // the opening animation can scroll the body AFTER the first reset.
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    const reset = () => {
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    };
    reset();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      reset();
      raf2 = requestAnimationFrame(reset);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isOpen]);

  // iOS-safe scroll lock.
  React.useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ zIndex: 100 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/*
            Single container that adapts between mobile (bottom sheet) and
            desktop (centered dialog) — children rendered ONCE to prevent
            duplicate form submissions when both layouts were in the DOM.

            Mobile  : anchored above the bottom nav, slides up
            Desktop : centered in viewport, fades + scales in
          */}
          <div
            style={{ zIndex: 100 }}
            className={cn(
              "fixed inset-x-0 md:inset-0",
              // Mobile: sit above the bottom nav bar
              "bottom-[calc(68px+env(safe-area-inset-bottom,0px))] md:bottom-auto",
              // Desktop: flex centering
              "md:flex md:items-center md:justify-center md:p-4",
              // Prevent desktop backdrop click from hitting panel
              "pointer-events-none",
            )}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              tabIndex={-1}
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.98 }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className={cn(
                "bg-card text-card-foreground border border-border shadow-lg pointer-events-auto flex flex-col focus:outline-none",
                // Mobile: full-width bottom sheet
                "w-full rounded-t-3xl modal-max-h",
                // Desktop: centered card
                "md:w-full md:max-w-lg md:rounded-2xl md:max-h-[90vh]",
                className,
              )}
            >
              {/* Drag handle (mobile only) */}
              <div className="pt-3 pb-1 flex justify-center flex-shrink-0 md:hidden">
                <div className="w-10 h-1.5 bg-primary rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-3 pb-4 md:pt-5 md:mb-0 flex-shrink-0">
                <div>
                  <h2 id={titleId} className="text-xl font-display font-bold text-foreground">{title}</h2>
                  {description && <p id={descriptionId} className="text-sm text-muted-foreground mt-1">{description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar" className="rounded-full -mr-2">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Scrollable body */}
              <div ref={bodyRef} className="overflow-y-auto flex-1 custom-scrollbar px-6 pb-6 md:pr-4">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : null;
}
