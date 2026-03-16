import React from "react";
import { useListBookings } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays, Plus } from "lucide-react";
import { format } from "date-fns";

export default function Bookings() {
  const { user } = useAuth();
  const { data: bookings, isLoading } = useListBookings(user?.crecheId || 1);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Bookings</h1>
          <p className="text-muted-foreground mt-1">Manage day use and lodging reservations.</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New Booking
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">Loading bookings...</div>
          ) : bookings?.length ? (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-white/5">
                  <tr>
                    <th className="px-6 py-4 font-medium">Pet</th>
                    <th className="px-6 py-4 font-medium">Type</th>
                    <th className="px-6 py-4 font-medium">Dates</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {bookings.map(booking => (
                    <tr key={booking.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{booking.petName}</td>
                      <td className="px-6 py-4 capitalize">{booking.type.replace('_', ' ')}</td>
                      <td className="px-6 py-4">
                        {format(new Date(booking.startDate), 'MMM d, yyyy')}
                        {booking.endDate && ` - ${format(new Date(booking.endDate), 'MMM d, yyyy')}`}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={booking.status === 'confirmed' ? 'success' : booking.status === 'pending' ? 'warning' : 'secondary'}>
                          {booking.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="ghost" size="sm">Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="No bookings found" description="There are no active bookings." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
