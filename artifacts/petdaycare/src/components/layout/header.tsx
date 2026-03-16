import React from "react";
import { UserProfile } from "@workspace/api-client-react";
import { Bell, Search } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface HeaderProps {
  user: UserProfile;
}

export function Header({ user }: HeaderProps) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <header className="h-20 border-b border-white/5 bg-background/50 backdrop-blur-xl z-20 flex items-center justify-between px-6 lg:px-8 sticky top-0">
      <div>
        <h1 className="text-2xl font-display font-semibold text-white tracking-tight flex items-center gap-2">
          {getGreeting()}, {user.name.split(' ')[0]} <span className="text-xl">👋</span>
        </h1>
        {user.crecheId && user.role !== "tutor" && (
          <p className="text-sm text-primary font-medium flex items-center gap-2 mt-0.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            Unit Active • 24 Pets Today
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden md:block w-64">
          <Input 
            icon={<Search className="h-4 w-4" />} 
            placeholder="Search pets, bookings..." 
            className="rounded-full bg-white/5 border-white/5 focus-visible:ring-1"
          />
        </div>
        
        <Button variant="glass" size="icon" className="rounded-full relative">
          <Bell className="h-5 w-5" />
          <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive border border-background"></span>
        </Button>
        
        <div className="h-10 w-10 rounded-full border border-white/10 overflow-hidden ml-2 shadow-[0_0_10px_rgba(255,255,255,0.05)]">
          <img 
            src={`${import.meta.env.BASE_URL}images/avatar-placeholder.png`} 
            alt={user.name} 
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
