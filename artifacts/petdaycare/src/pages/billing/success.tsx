import React from "react";
import { useLocation } from "wouter";
import { useConfirmBillingCheckout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function BillingSuccess() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const confirmMutation = useConfirmBillingCheckout();
  const [state, setState] = React.useState<"loading" | "success" | "error">("loading");
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
        onSuccess: () => {
          queryClient.invalidateQueries();
          setState("success");
        },
        onError: () => setState("error"),
      },
    );
  }, [confirmMutation, queryClient]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 animate-in fade-in duration-500">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center">
          {state === "loading" && (
            <>
              <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />
              <h1 className="text-xl font-display font-semibold text-white mb-2">Confirmando pagamento...</h1>
              <p className="text-sm text-muted-foreground">Aguarde só um instante.</p>
            </>
          )}

          {state === "success" && (
            <>
              <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
              <h1 className="text-xl font-display font-semibold text-white mb-2">Assinatura ativada!</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Seu plano já está ativo. Obrigado por usar o ArkPet.
              </p>
              <Button className="w-full" onClick={() => navigate("/assinatura")}>
                Ver minha assinatura
              </Button>
            </>
          )}

          {state === "error" && (
            <>
              <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <h1 className="text-xl font-display font-semibold text-white mb-2">Não conseguimos confirmar</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Se o pagamento foi concluído, a ativação acontece em instantes. Você pode verificar na página de assinatura.
              </p>
              <Button className="w-full" variant="ghost" onClick={() => navigate("/assinatura")}>
                Voltar para assinatura
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
