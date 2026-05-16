import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, usersTable } from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@arkpet.com.br";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ ...payload, icon: payload.icon ?? "/icons/icon.svg", badge: "/icons/icon.svg" }),
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    })
  );
}

export async function sendPushToRole(
  crecheId: number,
  role: "master_admin" | "creche_admin" | "staff" | "tutor",
  payload: PushPayload,
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const users = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, role)));
  const userIds = users.map((u) => u.id);
  if (!userIds.length) return;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ ...payload, icon: "/icons/icon.svg", badge: "/icons/icon.svg" }),
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    })
  );
}

export async function sendPushToUsers(userIds: number[], payload: PushPayload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !userIds.length) return;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ ...payload, icon: "/icons/icon.svg", badge: "/icons/icon.svg" }),
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        }
      }
    })
  );
}
