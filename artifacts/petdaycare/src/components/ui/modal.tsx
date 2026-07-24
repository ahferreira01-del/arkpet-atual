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
              initial={{ opacity: 0, y: 40, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.98 }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className={cn(
                "glass-panel pointer-events-auto flex flex-col",
                // Mobile: full-width bottom sheet
                "w-full rounded-t-3xl modal-max-h",
                // Desktop: centered card
                "md:w-full md:max-w-lg md:rounded-2xl md:max-h-[90vh]",
                className,
              )}
            >
              {/* Drag handle (mobile only) */}
              <div className="pt-3 pb-1 flex justify-center flex-shrink-0 md:hidden">
                <div className="w-10 h-1 bg-white/20 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-3 pb-4 md:pt-5 md:mb-0 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">{title}</h2>
                  {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full -mr-2">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto flex-1 custom-scrollbar px-6 pb-6 md:pr-4">
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
