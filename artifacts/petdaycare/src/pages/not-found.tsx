import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[100svh] w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md mx-auto shadow-sm border-border bg-card">
        <CardContent className="pt-6 flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-8 w-8 text-muted-foreground shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">404 — Página Não Encontrada</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            A página que você está procurando não existe ou foi movida.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
