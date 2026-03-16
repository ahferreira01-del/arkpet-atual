import React from "react";
import { useListCreches } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, TrendingUp } from "lucide-react";
// Recharts imported but simplified to avoid complex setups if missing
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const dummyData = [
  { name: 'Mon', revenue: 4000 },
  { name: 'Tue', revenue: 3000 },
  { name: 'Wed', revenue: 5000 },
  { name: 'Thu', revenue: 4500 },
  { name: 'Fri', revenue: 6000 },
  { name: 'Sat', revenue: 7000 },
  { name: 'Sun', revenue: 8000 },
];

export default function AdminDashboard() {
  const { data: creches, isLoading } = useListCreches();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Master Administration</h1>
        <p className="text-muted-foreground mt-1">Global oversight and SaaS metrics.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-primary/20 shadow-[0_0_30px_rgba(139,92,246,0.1)]">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Total MRR</p>
              <h3 className="text-3xl font-display font-bold text-white">$42,500</h3>
            </div>
            <div className="h-12 w-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
              <TrendingUp />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Active Creches</p>
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
              <p className="text-sm font-medium text-muted-foreground mb-1">Total Users</p>
              <h3 className="text-3xl font-display font-bold text-white">1,204</h3>
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
              <h3 className="text-lg font-display font-semibold mb-6">Revenue Overview</h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dummyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="name" stroke="#ffffff50" axisLine={false} tickLine={false} />
                    <YAxis stroke="#ffffff50" axisLine={false} tickLine={false} tickFormatter={(value) => `$${value}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #ffffff20', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6', strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-display font-semibold text-white">Managed Creches</h2>
          {isLoading ? (
            <div>Loading...</div>
          ) : creches?.length ? (
            <div className="space-y-4">
              {creches.map(creche => (
                <div key={creche.id} className="p-4 rounded-xl glass-panel flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white">{creche.name}</p>
                    <p className="text-sm text-muted-foreground">{creche.address}</p>
                  </div>
                  <Badge variant={creche.status === 'active' ? 'success' : 'secondary'}>{creche.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div>No creches found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
