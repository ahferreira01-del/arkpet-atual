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
  const initialTab = urlParams.get("tab") === "passeios" ? "passeios" : "tarefas";
  const [location, navigate] = useLocation();

  // Estado espelho exclusivo para a Presentation Layer (PageHeader)
  const [activeTabLabel, setActiveTabLabel] = React.useState(
    initialTab === "passeios" ? "Passeios" : "Tarefas"
  );

  const handleTabChange = (value: string) => {
    // 1. Atualiza o estado visual do título dinamicamente
    setActiveTabLabel(value === "passeios" ? "Passeios" : "Tarefas");
    
    // 2. Sincroniza a URL preservando o replace e parâmetros filhos existentes
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
        defaultTab={initialTab}
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
