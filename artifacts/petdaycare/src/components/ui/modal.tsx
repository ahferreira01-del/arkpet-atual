import * as React from "react";
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
  // Setting overflow:hidden on <body> does NOT prevent scrolling on Safari —
  // we must fix the body's position instead.
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

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — z-[100] inline-style for max safety (above nav z-50). */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ zIndex: 100 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* ── Mobile: bottom sheet ──────────────────────────────────────
              zIndex:100 inline-style guarantees it covers the BottomNav
              (z-50) regardless of Tailwind purge / arbitrary-value issues.
              max-h uses svh (small viewport = always excludes browser chrome)
              with vh fallback for iOS < 15.4.                              */}
          <div style={{ zIndex: 100 }} className="fixed inset-x-0 bottom-0 flex md:hidden">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className={cn(
                "glass-panel w-full rounded-t-3xl flex flex-col modal-max-h",
                className
              )}
            >
              {/* Drag handle */}
              <div className="pt-3 pb-1 flex justify-center flex-shrink-0">
                <div className="w-10 h-1 bg-white/20 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-3 pb-4 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">{title}</h2>
                  {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full -mr-2">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Scrollable body — pb-safe keeps content above home indicator */}
              <div className="overflow-y-auto flex-1 custom-scrollbar px-6 pb-safe">
                {children}
              </div>
            </motion.div>
          </div>

          {/* ── Desktop: centered dialog ──────────────────────────────────*/}
          <div style={{ zIndex: 100 }} className="fixed inset-0 hidden md:flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className={cn(
                "glass-panel w-full max-w-lg rounded-2xl p-6 pointer-events-auto max-h-[90vh] flex flex-col",
                className
              )}
            >
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">{title}</h2>
                  {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full -mr-2 -mt-2">
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="overflow-y-auto flex-1 custom-scrollbar pr-2">
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
