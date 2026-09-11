import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider, useAuth } from "./hooks/use-auth";
import { ThemeProvider } from "./components/theme-provider";
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
const AdminDashboard = React.lazy(() => import("./pages/admin/index"));
const AdminCreches = React.lazy(() => import("./pages/admin/creches"));
const AdminCampaigns = React.lazy(() => import("./pages/admin/campaigns"));
const AdminProposals = React.lazy(() => import("./pages/admin/proposals"));
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
const Terms = React.lazy(() => import("./pages/terms"));
const Privacy = React.lazy(() => import("./pages/privacy"));
const ThermalReceipt = React.lazy(() => import("./pages/thermal-receipt"));
const CrecheCampaigns = React.lazy(() => import("./pages/marketing/campaigns/index"));

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


function OperationGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      if (!["staff", "creche_admin"].includes(user.role) || !user.crecheId) {
        setLocation("/");
      }
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return null;
  if (user && (!["staff", "creche_admin"].includes(user.role) || !user.crecheId)) return null;
  return <>{children}</>;
}

function CrecheAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      if (user.role !== "creche_admin" || !user.crecheId) {
        setLocation("/");
      }
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return null;
  if (user && (user.role !== "creche_admin" || !user.crecheId)) return null;
  return <>{children}</>;
}

function RedirectToStaffBoard({ tab }: { tab?: "passeios" } = {}) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const destination = tab === "passeios" ? "/staff/board?tab=passeios" : "/staff/board";
    setLocation(destination, { replace: true });
  }, [setLocation, tab]);
  return null;
}

// Listens to messages from the service worker:
// - { kind: "navigate", path } → in-app navigation after notification click
// - { kind: "push", payload }   → refresh queries so the UI reflects the event
function ServiceWorkerBridge() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
          // Booking created or status changed — refresh lists and show a toast
          // so the creche sees an in-app alert even when the app is open.
          // The SW also always fires an OS notification for these types.
          queryClient.invalidateQueries({ queryKey: ["listBookings"] });
          queryClient.invalidateQueries({ queryKey: ["listPets"] });
          const title = msg.payload?.title;
          const body = msg.payload?.body;
          if (title) {
            toast({ title, description: body });
          }
        } else if (type === "walk") {
          queryClient.invalidateQueries({ queryKey: ["listWalks"] });
        } else if (type === "order") {
          // Creche: novo pedido da loja — atualiza lista e mostra toast.
          queryClient.invalidateQueries({ queryKey: ["listOrders"] });
          const title = msg.payload?.title;
          const body = msg.payload?.body;
          if (title) toast({ title, description: body });
        } else if (type === "order_status") {
          // Tutor: status do pedido atualizado — atualiza lista e mostra toast.
          queryClient.invalidateQueries({ queryKey: ["listOrders"] });
          const title = msg.payload?.title;
          const body = msg.payload?.body;
          if (title) toast({ title, description: body });
        } else if (type === "invoice_receipt") {
          // Creche admin: tutor sent a receipt — update the financial badge
          // immediately and show an in-app toast so they know even with the
          // app open (OS notification also always fires for this type).
          queryClient.invalidateQueries({ queryKey: ["financial-awaiting-count"] });
          toast({
            title: msg.payload?.title ?? "📎 Comprovante recebido",
            description: msg.payload?.body ?? "Um tutor enviou um comprovante.",
          });
        } else if (
          type === "invoice_paid" ||
          type === "invoice_voided" ||
          type === "invoice_refunded"
        ) {
          // Tutor: invoice status changed — refresh financial data and badge.
          queryClient.invalidateQueries({ queryKey: ["financial-awaiting-count"] });
          queryClient.invalidateQueries({ queryKey: ["tutor-invoices"] });
        } else if (petId) {
          queryClient.invalidateQueries({ queryKey: ["getPet"] });
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate, queryClient, toast]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
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
                <Route path="/termos">
                  <Terms />
                </Route>
                <Route path="/privacidade">
                  <Privacy />
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
                  <OperationGuard>
                    <RedirectToStaffBoard />
                  </OperationGuard>
                </Route>

                <Route path="/staff/board">
                  <OperationGuard>
                    <AppLayout>
                      <StaffBoard />
                    </AppLayout>
                  </OperationGuard>
                </Route>

                <Route path="/staff/manage">
                  <CrecheAdminGuard>
                    <AppLayout>
                      <ManageStaff />
                    </AppLayout>
                  </CrecheAdminGuard>
                </Route>

                <Route path="/walks">
                  <OperationGuard>
                    <RedirectToStaffBoard tab="passeios" />
                  </OperationGuard>
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

                <Route path="/admin/campaigns">
                  <AppLayout>
                    <AdminCampaigns />
                  </AppLayout>
                </Route>

                <Route path="/admin/proposals">
                  <AppLayout>
                    <AdminProposals />
                  </AppLayout>
                </Route>

                <Route path="/admin/users">
                  <AppLayout>
                    <AdminUsers />
                  </AppLayout>
                </Route>

                <Route path="/staff/qr-scanner">
                  <OperationGuard>
                    <AppLayout>
                      <QrScanner />
                    </AppLayout>
                  </OperationGuard>
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

                <Route path="/marketing/campaigns">
                  <OperationGuard>
                    <AppLayout>
                      <CrecheCampaigns />
                    </AppLayout>
                  </OperationGuard>
                </Route>

                <Route path="/financial">
                  <CrecheAdminGuard>
                    <AppLayout>
                      <FinancialDashboard />
                    </AppLayout>
                  </CrecheAdminGuard>
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

                <Route path="/receipt/:invoiceId">
                  <ThermalReceipt />
                </Route>

                <Route component={NotFound} />
              </Switch>
              </React.Suspense>
            </ChangePasswordGuard>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
