import React, { createContext, useContext, useState, ReactNode } from "react";

interface FinancialContextType {
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  globalSearch: string;
  setGlobalSearch: (search: string) => void;
}

const FinancialContext = createContext<FinancialContextType | undefined>(undefined);

export function FinancialProvider({ children }: { children: ReactNode }) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });

  const [globalSearch, setGlobalSearch] = useState("");

  return (
    <FinancialContext.Provider value={{ startDate, endDate, setStartDate, setEndDate, globalSearch, setGlobalSearch }}>
      {children}
    </FinancialContext.Provider>
  );
}

export function useFinancialContext() {
  const context = useContext(FinancialContext);
  if (context === undefined) {
    throw new Error("useFinancialContext must be used within a FinancialProvider");
  }
  return context;
}
