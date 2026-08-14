import React from "react";
import { useLocation } from "wouter";
import { useConfirmBillingCheckout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";

type State = "loading" | "success" | "pending" | "error";

export default function BillingSuccess() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const confirmMutation = useConfirmBillingCheckout();
  const [state, setState] = React.useState<State>("loading");
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setState("error");
      return;
    }

    confirmMutation.mutate(
      { data: { sessionId } },
      {
        onSuccess: (res: any) => {
          queryClient.invalidateQueries();
          if (res?.pending) {
            setState("pending");
          } else {
            setState("success");
          }
        },
        onError: () => setState("error"),
      },
    );
  }, [confirmMutation, queryClient]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6 animate-in fade-in zoom-in-95 duration-500">
      <Card className="max-w-md w-full border-border bg-card shadow-sm rounded-3xl overflow-hidden">
        <CardContent className="p-8 sm:p-10 text-center">
          {state === "loading" && (
            <div className="flex flex-col items-center">
              <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                 <Loader2 className="h-10 w-10 text-primary animate-spin" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-3 tracking-tight">Confirmando pagamento...</h1>
              <p className="text-[15px] text-muted-foreground font-medium">Aguarde só um instante, estamos validando seu pagamento de forma segura.</p>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center">
              <div className="h-20 w-20 bg-success/15 border border-success/30 rounded-full flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(var(--success-rgb),0.15)]">
                 <CheckCircle2 className="h-10 w-10 text-success" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-3 tracking-tight">Plano ativado!</h1>
              <p className="text-[15px] text-muted-foreground font-medium mb-8 leading-relaxed">
                Seu plano já está ativo. Obrigado por usar o ArkPet e fazer parte da nossa comunidade!
              </p>
              <Button className="w-full h-12 text-[15px] font-bold rounded-xl" onClick={() => navigate("/assinatura")}>
                Ver minha assinatura
              </Button>
            </div>
          )}

          {state === "pending" && (
            <div className="flex flex-col items-center">
              <div className="h-20 w-20 bg-warning/15 border border-warning/30 rounded-full flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(var(--warning-rgb),0.15)]">
                 <Clock className="h-10 w-10 text-warning" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-3 tracking-tight">Aguardando pagamento</h1>
              <p className="text-[15px] text-muted-foreground font-medium mb-3 leading-relaxed">
                Seu pagamento via <strong className="text-foreground">PIX ou Boleto</strong> ainda não foi confirmado.
              </p>
              <p className="text-[14px] text-muted-foreground/80 mb-8 leading-relaxed">
                Assim que o banco confirmar, seu plano será ativado automaticamente — normalmente em alguns minutos para PIX e em até 3 dias úteis para Boleto.
              </p>
              <div className="space-y-3 w-full">
                <Button className="w-full h-12 text-[15px] font-bold rounded-xl" onClick={() => navigate("/assinatura")}>
                  Ver minha assinatura
                </Button>
                <Button className="w-full h-12 text-[15px] font-semibold rounded-xl" variant="ghost" onClick={() => window.location.reload()}>
                  Verificar novamente
                </Button>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center">
              <div className="h-20 w-20 bg-destructive/15 border border-destructive/30 rounded-full flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(var(--destructive-rgb),0.15)]">
                 <XCircle className="h-10 w-10 text-destructive" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground mb-3 tracking-tight">Não conseguimos confirmar</h1>
              <p className="text-[15px] text-muted-foreground font-medium mb-8 leading-relaxed">
                Se o pagamento foi concluído, a ativação acontece em instantes. Você pode verificar na página de assinatura ou tentar novamente.
              </p>
              <Button className="w-full h-12 text-[15px] font-bold rounded-xl" variant="outline" onClick={() => navigate("/assinatura")}>
                Voltar para assinatura
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
