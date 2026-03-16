import React from "react";
import { useGetPet, useListVaccines, useListMedications, useListTimeline } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Dog, Syringe, Activity, Clock, Image as ImageIcon, Plus } from "lucide-react";
import { format } from "date-fns";

export default function PetDetail({ id }: { id: number }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const { data: pet, isLoading } = useGetPet(crecheId, id);

  if (isLoading) return <div className="p-8 text-center">Loading pet profile...</div>;
  if (!pet) return <div className="p-8 text-center text-destructive">Pet not found</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Profile Header */}
      <div className="glass-panel rounded-3xl p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center md:items-start relative overflow-hidden">
        <div className="absolute right-0 top-0 w-1/3 h-full bg-gradient-to-l from-primary/20 to-transparent pointer-events-none" />
        
        <div className="h-32 w-32 md:h-40 md:w-40 rounded-full border-4 border-background bg-secondary relative z-10 shadow-[0_0_30px_rgba(139,92,246,0.3)] overflow-hidden flex-shrink-0">
          {pet.photoUrl ? (
            <img src={pet.photoUrl} alt={pet.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-white/5">
              <Dog className="h-16 w-16 text-white/30" />
            </div>
          )}
        </div>

        <div className="flex-1 text-center md:text-left z-10">
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-2 justify-center md:justify-start">
            <h1 className="text-4xl font-display font-bold text-white tracking-tight">{pet.name}</h1>
            {pet.isCheckedIn ? <Badge variant="success" className="w-max mx-auto md:mx-0">Checked In</Badge> : <Badge variant="secondary" className="w-max mx-auto md:mx-0">Not Here</Badge>}
          </div>
          <p className="text-lg text-muted-foreground capitalize mb-6">{pet.breed || pet.species} • {pet.gender} • {pet.weight ? `${pet.weight} kg` : 'Weight unknown'}</p>
          
          <div className="flex flex-wrap gap-2 justify-center md:justify-start">
            {pet.temperament && <Badge variant="outline" className="capitalize bg-white/5"><Activity className="w-3 h-3 mr-1"/> {pet.temperament}</Badge>}
            {pet.allergies && <Badge variant="destructive" className="bg-destructive/20"><AlertCircle className="w-3 h-3 mr-1"/> Allergies</Badge>}
            {pet.specialNeeds && <Badge variant="warning" className="bg-amber-500/20 text-amber-300 border-amber-500/30"><AlertCircle className="w-3 h-3 mr-1"/> Special Needs</Badge>}
          </div>
        </div>

        <div className="flex gap-3 z-10 w-full md:w-auto">
          <Button variant="glass" className="flex-1 md:flex-none">Edit Profile</Button>
          {!pet.isCheckedIn && <Button className="flex-1 md:flex-none shadow-[0_0_20px_rgba(139,92,246,0.4)]">Check In</Button>}
        </div>
      </div>

      {/* Details Tabs */}
      <Tabs 
        defaultTab="overview"
        tabs={[
          { id: "overview", label: "Overview", content: <OverviewTab pet={pet} /> },
          { id: "medical", label: "Medical Records", icon: <Syringe className="h-4 w-4"/>, content: <MedicalTab crecheId={crecheId} petId={id} /> },
          { id: "timeline", label: "Timeline", icon: <Clock className="h-4 w-4"/>, content: <TimelineTab crecheId={crecheId} petId={id} /> },
        ]}
      />
    </div>
  );
}

function OverviewTab({ pet }: { pet: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardContent className="p-6 space-y-6">
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2">General Information</h3>
          <div className="grid grid-cols-2 gap-y-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Tutor</p>
              <p className="font-medium text-white">{pet.tutorName || "No tutor linked"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Birth Date</p>
              <p className="font-medium text-white">{pet.birthDate ? format(new Date(pet.birthDate), 'MMM d, yyyy') : "Unknown"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Color</p>
              <p className="font-medium text-white capitalize">{pet.color || "Unknown"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Status</p>
              <p className="font-medium text-white capitalize">{pet.status}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-6">
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2">Feeding Schedule</h3>
          {pet.feedingSchedule ? (
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-muted-foreground">Breakfast</span>
                <span className="font-medium">{pet.feedingSchedule.breakfastTime || "-"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-muted-foreground">Lunch</span>
                <span className="font-medium">{pet.feedingSchedule.lunchTime || "-"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-muted-foreground">Dinner</span>
                <span className="font-medium">{pet.feedingSchedule.dinnerTime || "-"}</span>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/5">
                <p className="text-muted-foreground mb-1">Food Details</p>
                <p className="font-medium text-white">{pet.feedingSchedule.foodType} • {pet.feedingSchedule.portionSize}</p>
              </div>
            </div>
          ) : (
            <EmptyState icon={Dog} title="No feeding schedule" description="Set up a feeding schedule for this pet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MedicalTab({ crecheId, petId }: { crecheId: number, petId: number }) {
  const { data: vaccines } = useListVaccines(crecheId, petId);
  const { data: medications } = useListMedications(crecheId, petId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
            <h3 className="text-lg font-display font-semibold">Vaccines</h3>
            <Button variant="outline" size="sm"><Plus className="w-4 h-4 mr-1"/> Add</Button>
          </div>
          {vaccines?.length ? (
            <div className="space-y-3">
              {vaccines.map(v => (
                <div key={v.id} className="p-3 rounded-xl bg-white/5 border border-white/10 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-white">{v.name}</p>
                    <p className="text-xs text-muted-foreground">Applied: {format(new Date(v.appliedDate), 'MMM d, yyyy')}</p>
                  </div>
                  {v.nextDueDate && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Next Due</p>
                      <p className="text-sm font-medium text-amber-400">{format(new Date(v.nextDueDate), 'MMM d, yyyy')}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Syringe} title="No vaccines" description="No vaccine records found." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
            <h3 className="text-lg font-display font-semibold">Medications</h3>
            <Button variant="outline" size="sm"><Plus className="w-4 h-4 mr-1"/> Add</Button>
          </div>
          {medications?.length ? (
            <div className="space-y-3">
              {medications.map(m => (
                <div key={m.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-medium text-white text-lg">{m.name}</p>
                    <Badge variant={m.isActive ? "success" : "secondary"}>{m.isActive ? "Active" : "Inactive"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{m.dosage} • {m.frequency}</p>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
                    {m.times.map(t => (
                      <Badge key={t} variant="outline" className="bg-black/40">{t}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Activity} title="No medications" description="No medication records found." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TimelineTab({ crecheId, petId }: { crecheId: number, petId: number }) {
  const { data: timeline } = useListTimeline(crecheId, petId);

  return (
    <Card>
      <CardContent className="p-6 max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-xl font-display font-semibold">Activity Timeline</h3>
          <Button><Plus className="w-4 h-4 mr-2"/> Add Event</Button>
        </div>

        {timeline?.length ? (
          <div className="relative pl-8 space-y-8 before:absolute before:inset-y-0 before:left-[15px] before:w-px before:bg-white/10">
            {timeline.map((event) => (
              <div key={event.id} className="relative">
                <div className="absolute -left-10 mt-1.5 h-6 w-6 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center shadow-[0_0_10px_rgba(139,92,246,0.3)]">
                  <div className="h-2 w-2 rounded-full bg-primary"></div>
                </div>
                <div className="glass-panel p-4 rounded-xl">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-semibold text-white capitalize">{event.type.replace('_', ' ')}</p>
                    <span className="text-xs text-muted-foreground">{format(new Date(event.createdAt), 'h:mm a')}</span>
                  </div>
                  {event.content && <p className="text-sm text-gray-300">{event.content}</p>}
                  {event.mediaUrl && (
                    <div className="mt-3 rounded-lg overflow-hidden max-h-64 bg-black/50">
                      <img src={event.mediaUrl} alt="Event media" className="w-full h-full object-contain" />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-white/5">Logged by {event.authorName}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Clock} title="No timeline events" description="No activities have been logged for this pet today." />
        )}
      </CardContent>
    </Card>
  );
}

// Ensure icon is defined or imported for warning badges
import { AlertCircle } from "lucide-react";
