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
  const activeTabLabel = activeTab === "passeios" ? "Passeios" : "Tarefas";
  const [location, navigate] = useLocation();

  const handleTabChange = (value: string) => {
    // Sincroniza a URL preservando o replace e parâmetros filhos existentes
    const newParams = new URLSearchParams(searchStr);
    newParams.set("tab", value);
    navigate(`${location}?${newParams.toString()}`, { replace: true });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-nav-safe">
      <PageHeader 
        title={activeTabLabel} 
        description="Acompanhe as tarefas operacionais e passeios da creche." 
        icon={CheckSquare}
      />
      <Tabs
        value={activeTab}
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
