import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { CrecheDashboard } from "./dashboard/components/creche-dashboard";
import { StaffDashboard } from "./dashboard/components/staff-dashboard";
import { TutorDashboard } from "./dashboard/components/tutor-dashboard";
import { MasterAdminDashboard } from "./dashboard/components/master-admin-dashboard";

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
  if (!user) return null;
  if (user.role === "staff") return <StaffDashboard user={user} />;
  if (user.role === "master_admin") return <MasterAdminDashboard />;
  if (user.role === "tutor") return <TutorDashboard user={user} />;
  if (!user.crecheId) return <div className="p-8 text-center text-muted-foreground">Nenhuma creche vinculada</div>;
  return <CrecheDashboard crecheId={user.crecheId} user={user} />;
}
