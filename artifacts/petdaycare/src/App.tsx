import React from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider } from "./hooks/use-auth";
import { AppLayout } from "./components/layout/app-layout";

import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import PetsDirectory from "./pages/pets/index";
import PetDetail from "./pages/pets/detail";
import Bookings from "./pages/bookings/index";
import StaffDashboard from "./pages/staff/index";
import AdminDashboard from "./pages/admin/index";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Switch>
              <Route path="/login"><Login /></Route>
              
              <Route path="/">
                <AppLayout><Dashboard /></AppLayout>
              </Route>
              
              <Route path="/pets">
                <AppLayout><PetsDirectory /></AppLayout>
              </Route>
              
              <Route path="/pets/:id">
                {params => <AppLayout><PetDetail id={Number(params.id)} /></AppLayout>}
              </Route>
              
              <Route path="/bookings">
                <AppLayout><Bookings /></AppLayout>
              </Route>
              
              <Route path="/staff">
                <AppLayout><StaffDashboard /></AppLayout>
              </Route>
              
              <Route path="/admin">
                <AppLayout><AdminDashboard /></AppLayout>
              </Route>
              
              <Route component={NotFound} />
            </Switch>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
