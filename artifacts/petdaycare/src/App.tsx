import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider, useAuth } from "./hooks/use-auth";
import { AppLayout } from "./components/layout/app-layout";
import { PushPrompt } from "./components/push-prompt";
import { UpdatePrompt } from "./components/update-prompt";
const ChangePasswordPage = React.lazy(() => import("./pages/change-password"));

const Login = React.lazy(() => import("./pages/login"));
const RegisterCreche = React.lazy(() => import("./pages/register-creche"));
const ForgotPassword = React.lazy(() => import("./pages/forgot-password"));
const ResetPassword = React.lazy(() => import("./pages/reset-password"));
const Dashboard = React.lazy(() => import("./pages/dashboard"));
const PetsDirectory = React.lazy(() => import("./pages/pets/index"));
const PetDetail = React.lazy(() => import("./pages/pets/detail"));
const Bookings = React.lazy(() => import("./pages/bookings/index"));
const NewBooking = React.lazy(() => import("./pages/bookings/new"));
const StaffDashboard = React.lazy(() => import("./pages/staff/index"));
const AdminDashboard = React.lazy(() => import("./pages/admin/index"));
const AdminCreches = React.lazy(() => import("./pages/admin/creches"));
const Chat = React.lazy(() => import("./pages/chat/index"));
const StaffBoard = React.lazy(() => import("./pages/staff/board"));
const ManageStaff = React.lazy(() => import("./pages/staff/manage"));
const Settings = React.lazy(() => import("./pages/settings/index"));
const AdminUsers = React.lazy(() => import("./pages/admin/users"));
const QrScanner = React.lazy(() => import("./pages/staff/qr-scanner"));
const Tutors = React.lazy(() => import("./pages/tutors/index"));
const Billing = React.lazy(() => import("./pages/billing/index"));
const BillingSuccess = React.lazy(() => import("./pages/billing/success"));
const NotFound = React.lazy(() => import("./pages/not-found"));
const FinancialDashboard = React.lazy(() => import("./pages/financial/index"));
const TutorFinancial = React.lazy(() => import("./pages/tutor/financial"));
const TutorStore = React.lazy(() => import("./pages/tutor/store"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    },
  },
});

function ChangePasswordGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  if (
    isLoading ||
    location === "/login" ||
    location === "/cadastro" ||
    location === "/recuperar-senha" ||
    location === "/redefinir-senha"
  )
    return <>{children}</>;
  if (user && (user as any).mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}

function FinancialGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && user.role === "staff") {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return null;
  if (user?.role === "staff") return null;
  return <>{children}</>;
}

function RedirectToStaffBoard() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/staff/board", { replace: true });
  }, [setLocation]);
  return null;
}

// Listens to messages from the service worker:
// - { kind: "navigate", path } → in-app navigation after notification click
// - { kind: "push", payload }   → refresh queries so the UI reflects the event
function ServiceWorkerBridge() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "navigate" && typeof msg.path === "string") {
        navigate(msg.path);
      } else if (msg.kind === "push") {
        // Scoped refresh based on push type — keeps the UI live without
        // triggering a full app-wide refetch storm on every notification.
        // msg.payload is the full push payload: { title, body, tag, data: { type, ... } }
        // The actual type lives in msg.payload.data.type, not msg.payload.type.
        const type = msg.payload?.data?.type ?? msg.payload?.type;
        const petId = msg.payload?.data?.petId;
        if (type === "chat") {
          // Invalidate both the messages for the open conversation and the
          // conversations list (so last-message preview + unread badge refresh).
          queryClient.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).includes("/chat"),
          });
          queryClient.invalidateQueries({ queryKey: ["chat-unread"] });
        } else if (type === "task") {
          queryClient.invalidateQueries({ queryKey: ["listTasks"] });
        } else if (
          type === "booking" ||
          type === "checkin" ||
          type === "checkout" ||
          type === "ontheway"
        ) {
          queryClient.invalidateQueries({ queryKey: ["listBookings"] });
          queryClient.invalidateQueries({ queryKey: ["listPets"] });
        } else if (type === "walk") {
          queryClient.invalidateQueries({ queryKey: ["listWalks"] });
        } else if (petId) {
          queryClient.invalidateQueries({ queryKey: ["getPet"] });
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate, queryClient]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UpdatePrompt />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <ServiceWorkerBridge />
            <PushPrompt />
            <ChangePasswordGuard>
              <React.Suspense fallback={<div className="flex h-screen w-full items-center justify-center text-muted-foreground">Carregando...</div>}>
              <Switch>
                <Route path="/login">
                  <Login />
                </Route>
                <Route path="/cadastro">
                  <RegisterCreche />
                </Route>
                <Route path="/recuperar-senha">
                  <ForgotPassword />
                </Route>
                <Route path="/redefinir-senha">
                  <ResetPassword />
                </Route>

                <Route path="/">
                  <AppLayout>
                    <Dashboard />
                  </AppLayout>
                </Route>

                <Route path="/pets">
                  <AppLayout>
                    <PetsDirectory />
                  </AppLayout>
                </Route>

                <Route path="/pets/:id">
                  {(params) => (
                    <AppLayout>
                      <PetDetail id={Number(params.id)} />
                    </AppLayout>
                  )}
                </Route>

                <Route path="/bookings/new">
                  <AppLayout>
                    <NewBooking />
                  </AppLayout>
                </Route>
                <Route path="/bookings">
                  <AppLayout>
                    <Bookings />
                  </AppLayout>
                </Route>

                <Route path="/staff">
                  <RedirectToStaffBoard />
                </Route>

                <Route path="/staff/board">
                  <AppLayout>
                    <StaffBoard />
                  </AppLayout>
                </Route>

                <Route path="/staff/manage">
                  <AppLayout>
                    <ManageStaff />
                  </AppLayout>
                </Route>

                <Route path="/walks">
                  <RedirectToStaffBoard />
                </Route>

                <Route path="/chat">
                  <AppLayout>
                    <Chat />
                  </AppLayout>
                </Route>

                <Route path="/settings">
                  <AppLayout>
                    <Settings />
                  </AppLayout>
                </Route>

                <Route path="/admin">
                  <AppLayout>
                    <AdminDashboard />
                  </AppLayout>
                </Route>

                <Route path="/admin/creches">
                  <AppLayout>
                    <AdminCreches />
                  </AppLayout>
                </Route>

                <Route path="/admin/users">
                  <AppLayout>
                    <AdminUsers />
                  </AppLayout>
                </Route>

                <Route path="/staff/qr-scanner">
                  <AppLayout>
                    <QrScanner />
                  </AppLayout>
                </Route>

                <Route path="/tutors">
                  <AppLayout>
                    <Tutors />
                  </AppLayout>
                </Route>

                <Route path="/assinatura/sucesso">
                  <AppLayout>
                    <BillingSuccess />
                  </AppLayout>
                </Route>

                <Route path="/assinatura">
                  <AppLayout>
                    <Billing />
                  </AppLayout>
                </Route>

                <Route path="/financial">
                  <FinancialGuard>
                    <AppLayout>
                      <FinancialDashboard />
                    </AppLayout>
                  </FinancialGuard>
                </Route>

                <Route path="/tutor/financial">
                  <AppLayout>
                    <TutorFinancial />
                  </AppLayout>
                </Route>

                <Route path="/tutor/store">
                  <AppLayout>
                    <TutorStore />
                  </AppLayout>
                </Route>

                <Route component={NotFound} />
              </Switch>
              </React.Suspense>
            </ChangePasswordGuard>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
