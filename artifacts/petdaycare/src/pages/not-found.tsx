import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[100svh] w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md mx-auto shadow-sm border-border bg-card">
        <CardContent className="pt-6 flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-8 w-8 text-muted-foreground shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">404 — Página Não Encontrada</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground mb-6">
            A página que você está procurando não existe ou foi movida.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Link
              href="/"
              className="inline-flex items-center justify-center flex-1 h-11 sm:h-10 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Home className="w-4 h-4 mr-2" />
              Voltar ao Início
            </Link>
            <Button
              variant="outline"
              onClick={() => window.history.back()}
              className="flex-1 h-11 sm:h-10 rounded-xl"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Página Anterior
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
