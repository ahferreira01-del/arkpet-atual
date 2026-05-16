import React from "react";
import { useListCreches } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const dummyData = [
  { name: 'Seg', receita: 4000 },
  { name: 'Ter', receita: 3000 },
  { name: 'Qua', receita: 5000 },
  { name: 'Qui', receita: 4500 },
  { name: 'Sex', receita: 6000 },
  { name: 'Sáb', receita: 7000 },
  { name: 'Dom', receita: 8000 },
];

export default function AdminDashboard() {
  const { data: creches, isLoading } = useListCreches();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Administração Master</h1>
        <p className="text-muted-foreground mt-1">Visão global da rede ArkPet.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-primary/20 shadow-[0_0_30px_rgba(139,92,246,0.1)]">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">MRR Total</p>
              <h3 className="text-3xl font-display font-bold text-white">R$ 42.500</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
              <TrendingUp />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Creches Ativas</p>
              <h3 className="text-3xl font-display font-bold text-white">{creches?.length || 0}</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
              <Building2 />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Total de Usuários</p>
              <h3 className="text-3xl font-display font-bold text-white">1.204</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
              <Users />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardContent className="p-6">
              <h3 className="text-lg font-display font-semibold mb-6">Visão de Receita</h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dummyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="name" stroke="#ffffff50" axisLine={false} tickLine={false} />
                    <YAxis stroke="#ffffff50" axisLine={false} tickLine={false} tickFormatter={(value) => `R$${value}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #ffffff20', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(value: any) => [`R$ ${value}`, 'Receita']}
                    />
                    <Line type="monotone" dataKey="receita" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-display font-semibold text-white">Creches Cadastradas</h2>
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Carregando...</div>
          ) : creches?.length ? (
            <div className="space-y-4">
              {creches.map(creche => (
                <div key={creche.id} className="p-4 rounded-xl glass-panel flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white">{creche.name}</p>
                    <p className="text-sm text-muted-foreground">{creche.address || "Endereço não informado"}</p>
                  </div>
                  <Badge variant={creche.status === 'active' ? 'success' : 'secondary'}>
                    {creche.status === 'active' ? 'Ativa' : 'Inativa'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">Nenhuma creche encontrada.</div>
          )}
        </div>
      </div>
    </div>
  );
}
