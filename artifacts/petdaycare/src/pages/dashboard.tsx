import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListTasks, useListPets, useGetCrecheStats, ListTasksStatus, ListPetsStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckSquare, Dog, TrendingUp, Calendar, AlertCircle } from "lucide-react";
import { Link } from "wouter";

// We route internally based on role
export default function Dashboard() {
  const { user } = useAuth();
  
  if (user?.role === "staff") return <StaffDashboard user={user} />;
  if (user?.role === "master_admin") return <div className="p-8">Master Admin Dashboard (See Admin Page)</div>;
  if (user?.role === "tutor") return <div className="p-8">Tutor Dashboard</div>;
  
  // Default: Creche Admin
  return <CrecheDashboard crecheId={user?.crecheId || 1} />;
}

function CrecheDashboard({ crecheId }: { crecheId: number }) {
  const { data: stats, isLoading: statsLoading } = useGetCrecheStats(crecheId);
  const { data: pets, isLoading: petsLoading } = useListPets(crecheId, { status: "checked_in" as ListPetsStatus });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Current Occupancy" value={stats ? `${stats.currentOccupancy}/${stats.maxCapacity}` : "-"} icon={<Dog />} trend="+2 today" />
        <StatCard title="Today's Check-ins" value={stats?.todayCheckIns?.toString() || "-"} icon={<Calendar />} />
        <StatCard title="Pending Bookings" value={stats?.pendingBookings?.toString() || "-"} icon={<AlertCircle />} alert={stats?.pendingBookings ? true : false} />
        <StatCard title="Pending Tasks" value={stats?.pendingTasks?.toString() || "-"} icon={<CheckSquare />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-white">Checked-in Pets</h2>
            <Link href="/pets"><Button variant="outline" size="sm">View All</Button></Link>
          </div>
          
          <Card>
            <CardContent className="p-0">
              {petsLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading pets...</div>
              ) : pets?.length ? (
                <div className="divide-y divide-white/5">
                  {pets.map(pet => (
                    <div key={pet.id} className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-primary/40 to-accent/40 flex items-center justify-center p-1">
                          {pet.photoUrl ? (
                            <img src={pet.photoUrl} alt={pet.name} className="h-full w-full rounded-full object-cover" />
                          ) : (
                            <Dog className="h-6 w-6 text-white" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-white">{pet.name}</p>
                          <p className="text-sm text-muted-foreground capitalize">{pet.breed || pet.species}</p>
                        </div>
                      </div>
                      <Badge variant="success">Checked In</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Dog} title="No pets currently" description="There are no pets checked in right now." className="py-12" />
              )}
            </CardContent>
          </Card>
        </div>
        
        <div className="space-y-6">
          <h2 className="text-xl font-display font-semibold text-white">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4">
            <Link href="/bookings/new">
              <Button variant="glass" className="w-full justify-start h-14 text-base"><Calendar className="mr-3" /> New Booking</Button>
            </Link>
            <Link href="/pets">
              <Button variant="glass" className="w-full justify-start h-14 text-base"><Dog className="mr-3" /> Register Pet</Button>
            </Link>
            <Link href="/staff">
              <Button variant="glass" className="w-full justify-start h-14 text-base"><CheckSquare className="mr-3" /> View Tasks</Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffDashboard({ user }: { user: any }) {
  const crecheId = user.crecheId || 1;
  const { data: tasks, isLoading } = useListTasks(crecheId, { status: "pending" as ListTasksStatus });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-display font-semibold text-white">My Checklist</h2>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">Loading tasks...</div>
          ) : tasks?.length ? (
            <div className="divide-y divide-white/5">
              {tasks.map(task => (
                <div key={task.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 h-5 w-5 rounded border border-white/20 flex items-center justify-center cursor-pointer hover:border-primary"></div>
                    <div>
                      <p className="font-medium text-white">{task.title}</p>
                      <p className="text-sm text-muted-foreground">{task.petName ? `For: ${task.petName}` : "General task"} • {new Date(task.scheduledFor).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                  </div>
                  <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>{task.priority}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={CheckSquare} title="All caught up!" description="You have no pending tasks right now." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, icon, trend, alert }: any) {
  return (
    <Card className={`relative overflow-hidden ${alert ? 'border-destructive/50 shadow-[0_0_20px_rgba(220,38,38,0.15)]' : ''}`}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-3xl font-display font-bold text-white">{value}</h3>
            {trend && <p className="text-sm text-emerald-400 mt-2 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> {trend}</p>}
          </div>
          <div className="h-12 w-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
