import React, { useState, useRef, useEffect } from "react";
import { AssistantLauncher } from "./AssistantLauncher";
import { AssistantPanel } from "./AssistantPanel";

export function AssistantContainer({ userRole }: { userRole?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setIsMinimized(false);
    };
    window.addEventListener("arkpet:open-assistant", handleOpen);
    return () => window.removeEventListener("arkpet:open-assistant", handleOpen);
  }, []);

  return (
    <>
      <AssistantLauncher
        isOpen={isOpen && !isMinimized}
        onToggle={() => {
          setIsOpen((prev) => !prev);
          setIsMinimized(false);
        }}
        userRole={userRole}
        triggerButtonRef={triggerRef}
      />
      <AssistantPanel
        isOpen={isOpen}
        isMinimized={isMinimized}
        onClose={() => setIsOpen(false)}
        onToggleMinimize={() => setIsMinimized((prev) => !prev)}
        userRole={userRole}
        triggerButtonRef={triggerRef}
      />
    </>
  );
}

export default AssistantContainer;
export { AssistantLauncher, AssistantPanel };
