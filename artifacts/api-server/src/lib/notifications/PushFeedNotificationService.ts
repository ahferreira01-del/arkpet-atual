import { inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { petsTable } from "@workspace/db/schema";
import { sendPushToUser } from "../push.js";
import type { IFeedNotificationService, FeedPublishedEvent } from "./IFeedNotificationService.js";

const TYPE_LABELS: Record<string, string> = {
  photo:      "📸 Nova foto",
  video:      "🎬 Novo vídeo",
  note:       "📝 Nova nota",
  play:       "🎾 Momento de brincadeira",
  walk:       "🦮 Passeio",
  feeding:    "🍽️ Alimentação",
  medication: "💊 Medicação",
  health:     "🩺 Registro de saúde",
  check_in:   "✅ Check-in",
  check_out:  "👋 Check-out",
};

export class PushFeedNotificationService implements IFeedNotificationService {
  /**
   * Fire-and-forget: setImmediate guarantees execution starts only AFTER the
   * current event loop tick (i.e. after the HTTP response has been flushed).
   */
  onPostPublished(event: FeedPublishedEvent): void {
    setImmediate(() => {
      this.dispatch(event).catch((err: unknown) => {
        console.error("[feed-notifications] dispatch error", {
          postId: event.postId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  private async dispatch(event: FeedPublishedEvent): Promise<void> {
    if (event.petIds.length === 0) return;

    const pets = await db
      .select({ id: petsTable.id, name: petsTable.name, tutorId: petsTable.tutorId })
      .from(petsTable)
      .where(inArray(petsTable.id, event.petIds));

    // Deduplicate tutor IDs — one tutor may own multiple tagged pets
    const tutorIds = [
      ...new Set(
        pets
          .map((p) => p.tutorId)
          .filter((id): id is number => id != null),
      ),
    ];

    if (tutorIds.length === 0) return;

    const title = TYPE_LABELS[event.type] ?? "Atualização na creche";

    const results = await Promise.allSettled(
      tutorIds.map((tutorId) => {
        const petNames = pets
          .filter((p) => p.tutorId === tutorId)
          .map((p) => p.name)
          .join(", ");
        return sendPushToUser(tutorId, { title, body: `Atualização sobre ${petNames}` });
      }),
    );

    results.forEach((result, idx) => {
      if (result.status === "rejected") {
        console.error("[feed-notifications] push failed", {
          tutorId: tutorIds[idx],
          reason: result.reason instanceof Error ? result.reason.message : result.reason,
        });
      }
    });
  }
}
