import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const initialState: ThemeProviderState = {
  theme: "dark",
  setTheme: () => null,
  toggleTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: ThemeProviderProps) {
  // Inicializa o state LENDO o que o script Anti-FOUC já decidiu.
  // Isso evita uma "segunda decisão" durante o bootstrap do React.
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const isDark = document.documentElement.classList.contains("dark");
      return isDark ? "dark" : "light";
    } catch {
      return defaultTheme;
    }
  });

  const setTheme = (newTheme: Theme) => {
    try {
      localStorage.setItem("arkpet-theme", newTheme);
    } catch {
      // Ignora silenciosamente se o localStorage estiver indisponível
    }
    
    setThemeState(newTheme);
    
    const root = document.documentElement;
    if (newTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    root.setAttribute("data-theme", newTheme);
    root.style.colorScheme = newTheme;
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Sync state if something external changes the theme
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "arkpet-theme") {
        setTheme((e.newValue === "light" ? "light" : "dark") as Theme);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
