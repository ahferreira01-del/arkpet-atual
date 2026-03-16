import React, { useState } from "react";
import { useGetCreche, useUpdateCreche } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, MapPin, Phone, Globe, Save, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: creche, isLoading } = useGetCreche(crecheId);
  const updateMutation = useUpdateCreche();
  const [saved, setSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateMutation.mutate(
      {
        crecheId,
        data: {
          name: formData.get("name") as string,
          address: formData.get("address") as string,
          phone: formData.get("phone") as string,
          maxCapacity: Number(formData.get("maxCapacity")),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      }
    );
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading settings...</div>;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your creche profile and configuration.</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
            <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-lg font-display font-semibold text-white">Creche Information</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" /> Creche Name
              </label>
              <Input name="name" defaultValue={creche?.name || ""} required />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" /> Address
              </label>
              <Input name="address" defaultValue={creche?.address || ""} placeholder="Rua das Flores, 123 - São Paulo" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" /> Phone
                </label>
                <Input name="phone" defaultValue={creche?.phone || ""} placeholder="(11) 99999-9999" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" /> Max Capacity
                </label>
                <Input name="maxCapacity" type="number" min={1} max={200} defaultValue={creche?.maxCapacity || 15} />
              </div>
            </div>

            <div className="pt-4 flex items-center gap-4">
              <Button type="submit" isLoading={updateMutation.isPending}>
                <Save className="mr-2 h-4 w-4" /> Save Changes
              </Button>
              {saved && (
                <p className="text-sm text-emerald-400 flex items-center gap-1">
                  ✓ Settings saved successfully
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
            <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center">
              <Globe className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-display font-semibold text-white">Account Info</h2>
          </div>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Your Name</p>
              <p className="font-medium text-white">{user?.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Email</p>
              <p className="font-medium text-white">{user?.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Role</p>
              <p className="font-medium text-white capitalize">{user?.role?.replace("_", " ")}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Creche ID</p>
              <p className="font-medium text-white">#{crecheId}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
