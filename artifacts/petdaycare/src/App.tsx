import React from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider, useAuth } from "./hooks/use-auth";
import { AppLayout } from "./components/layout/app-layout";
import ChangePasswordPage from "./pages/change-password";

import Login from "./pages/login";
import Dashboard from "./pages/dashboard";
import PetsDirectory from "./pages/pets/index";
import PetDetail from "./pages/pets/detail";
import Bookings from "./pages/bookings/index";
import StaffDashboard from "./pages/staff/index";
import AdminDashboard from "./pages/admin/index";
import AdminCreches from "./pages/admin/creches";
import Chat from "./pages/chat/index";
import Walks from "./pages/walks/index";
import ManageStaff from "./pages/staff/manage";
import Settings from "./pages/settings/index";
import AdminUsers from "./pages/admin/users";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ChangePasswordGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  if (isLoading || location === "/login") return <>{children}</>;
  if (user && (user as any).mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <ChangePasswordGuard>
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

              <Route path="/staff/manage">
                <AppLayout><ManageStaff /></AppLayout>
              </Route>

              <Route path="/walks">
                <AppLayout><Walks /></AppLayout>
              </Route>

              <Route path="/chat">
                <AppLayout><Chat /></AppLayout>
              </Route>

              <Route path="/settings">
                <AppLayout><Settings /></AppLayout>
              </Route>

              <Route path="/admin">
                <AppLayout><AdminDashboard /></AppLayout>
              </Route>

              <Route path="/admin/creches">
                <AppLayout><AdminCreches /></AppLayout>
              </Route>

              <Route path="/admin/users">
                <AppLayout><AdminUsers /></AppLayout>
              </Route>

              <Route component={NotFound} />
            </Switch>
          </ChangePasswordGuard>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
