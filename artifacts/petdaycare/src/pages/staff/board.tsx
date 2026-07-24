import React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { CheckSquare } from "lucide-react";
import { useSearch, useLocation } from "wouter";
import { Tabs } from "@/components/ui/tabs";
import StaffTasks from "./index";
import Walks from "../walks/index";

export default function StaffBoard() {
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const activeTab = urlParams.get("tab") === "passeios" ? "passeios" : "tarefas";
  const [location, navigate] = useLocation();

  const handleTabChange = (value: string) => {
    navigate(`${location}?tab=${value}`, { replace: true });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader 
        title="Tarefas" 
        description="Acompanhe as tarefas operacionais e passeios da creche." 
        icon={CheckSquare}
      />
      <Tabs
        defaultTab={activeTab}
        onValueChange={handleTabChange}
        tabs={[
          {
            id: "tarefas",
            label: "Tarefas",
            content: <StaffTasks hideHeader />
          },
          {
            id: "passeios",
            label: "Passeios",
            content: <Walks hideHeader />
          }
        ]}
      />
    </div>
  );
}
