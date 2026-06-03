import React from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);

  const mutation = useForgotPassword({
    mutation: {
      onSuccess: () => setSent(true),
      onError: () => setSent(true), // endpoint never reveals existence; treat as sent
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    mutation.mutate({ data: { email: email.trim() } } as any);
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      <div className="w-full max-w-sm mx-auto flex flex-col justify-center px-6 py-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}icons/arkpet-logo.png`} alt="ArkPet" className="h-20 w-20 mb-4 opacity-90" />
          <span className="font-display font-bold text-2xl tracking-tight text-foreground">ArkPet</span>
        </div>

        <Card className="border-border shadow-md bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Recuperar senha</CardTitle>
            <CardDescription>
              {sent
                ? "Verifique seu e-mail"
                : "Informe seu e-mail e enviaremos um link para redefinir sua senha."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-sm text-muted-foreground">
                  Se o e-mail <span className="font-medium text-foreground">{email}</span> estiver cadastrado, você receberá um link de redefinição em instantes. O link expira em 1 hora.
                </div>
                <Link href="/login">
                  <Button variant="outline" className="w-full" size="lg">Voltar ao login</Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com.br" required />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg" isLoading={mutation.isPending}>
                  Enviar link de redefinição
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  <Link href="/login" className="text-foreground font-medium hover:underline">Voltar ao login</Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
