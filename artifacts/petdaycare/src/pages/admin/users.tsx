import React from "react";
import { useListUsers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Users, Mail, Building2 } from "lucide-react";
import { format } from "date-fns";

const roleColors: Record<string, string> = {
  master_admin: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  creche_admin: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  staff: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  tutor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();

  const roleCount = (role: string) => users?.filter((u) => u.role === role).length || 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">All Users</h1>
        <p className="text-muted-foreground mt-1">Global view of every user across all creches.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["master_admin", "creche_admin", "staff", "tutor"].map((role) => (
          <Card key={role}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground capitalize mb-1">{role.replace("_", " ")}</p>
              <p className="text-3xl font-display font-bold text-white">{roleCount(role)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading users...</div>
          ) : users?.length ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-white/5">
                  <tr>
                    <th className="px-6 py-4 font-medium">User</th>
                    <th className="px-6 py-4 font-medium">Role</th>
                    <th className="px-6 py-4 font-medium">Creche</th>
                    <th className="px-6 py-4 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/40 to-accent/40 flex items-center justify-center text-white font-bold">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-white">{u.name}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Mail className="h-3 w-3" />{u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border capitalize ${roleColors[u.role] || ""}`}>
                          {u.role.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {u.crecheId ? (
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" /> Creche #{u.crecheId}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {format(new Date(u.createdAt), "MMM d, yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="No users found" description="No users registered yet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
