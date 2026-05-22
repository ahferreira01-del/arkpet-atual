import React, { ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import { Loader2 } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center flex flex-col items-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
          <h2 className="text-xl font-display text-white">Carregando ArkPet...</h2>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-dvh bg-background overflow-hidden relative">
      {/* Ambient background glow */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[40%] h-[50%] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />

      {/* Desktop sidebar */}
      <Sidebar user={user} />

      {/* h-dvh so the content column fills the real visual viewport on mobile
          (100vh can be wrong when the browser toolbar is visible) */}
      <div className="flex-1 flex flex-col h-dvh overflow-hidden relative z-0">
        <Header user={user} />
        {/* pb-nav-safe: clears the fixed bottom nav + system gesture/notch area.
            On md+ (desktop) the bottom nav is hidden so we revert to p-6/p-8. */}
        <main className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 lg:p-8 pb-nav-safe md:pb-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav user={user} />
    </div>
  );
}
