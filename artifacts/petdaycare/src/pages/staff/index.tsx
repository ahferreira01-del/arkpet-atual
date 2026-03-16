import React from "react";
import { useListTasks, useCompleteTask, ListTasksStatus } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckSquare, CircleDashed, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

export default function StaffDashboard() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const { data: tasks, isLoading } = useListTasks(crecheId);
  const completeTaskMutation = useCompleteTask();

  const handleComplete = (taskId: number) => {
    completeTaskMutation.mutate({ crecheId, taskId, data: {} }, {
      onSuccess: () => window.location.reload() // Demo refresh
    });
  };

  const pendingTasks = tasks?.filter(t => t.status === 'pending') || [];
  const completedTasks = tasks?.filter(t => t.status === 'completed') || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Daily Tasks</h1>
        <p className="text-muted-foreground mt-1">{format(new Date(), 'EEEE, MMMM do yyyy')}</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <h2 className="text-xl font-display font-semibold mb-6 flex items-center gap-2">
            <CircleDashed className="text-amber-400" /> Pending ({pendingTasks.length})
          </h2>
          
          {isLoading ? (
            <div className="text-center py-8">Loading tasks...</div>
          ) : pendingTasks.length ? (
            <div className="space-y-3">
              {pendingTasks.map(task => (
                <div key={task.id} className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between hover:bg-white/10 transition-all group">
                  <div className="flex flex-col">
                    <p className="font-semibold text-white text-lg">{task.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {task.petName && <span className="text-primary font-medium mr-2">{task.petName}</span>}
                      {format(new Date(task.scheduledFor), 'h:mm a')} • <span className="capitalize">{task.type}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={task.priority === "high" ? "destructive" : "secondary"}>{task.priority}</Badge>
                    <Button 
                      onClick={() => handleComplete(task.id)}
                      variant="glass" 
                      className="group-hover:bg-primary group-hover:text-white group-hover:border-primary border-white/20 transition-all"
                    >
                      Complete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={CheckSquare} title="All caught up!" description="You have completed all your tasks." />
          )}
        </CardContent>
      </Card>

      {completedTasks.length > 0 && (
        <div className="opacity-60 hover:opacity-100 transition-opacity">
          <h2 className="text-xl font-display font-semibold mb-6 flex items-center gap-2 px-6">
            <CheckCircle2 className="text-emerald-400" /> Completed Today ({completedTasks.length})
          </h2>
          <div className="space-y-3 px-6">
            {completedTasks.map(task => (
              <div key={task.id} className="p-4 rounded-xl bg-transparent border border-white/5 flex items-center justify-between">
                <div>
                  <p className="font-medium text-white line-through">{task.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">Completed at {task.completedAt ? format(new Date(task.completedAt), 'h:mm a') : 'Unknown'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
