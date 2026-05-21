import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, usersTable } from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@arkpet.com.br";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[push] VAPID configured.");
} else {
  console.warn("[push] VAPID keys missing — push notifications disabled.");
}

// Push service topic must be URL-safe base64 (RFC 8030), max 32 chars.
// We hash the tag to a stable, short identifier.
function makeTopic(tag: string): string {
  let hash = 5381;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) + hash + tag.charCodeAt(i)) >>> 0;
  return Buffer.from(String(hash)).toString("base64url").slice(0, 32);
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

async function sendToSubscription(
  sub: { id: number; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        ...payload,
        // Let the SW resolve icon paths against its own scope.
        icon: payload.icon,
      }),
      {
        // Keep notification queued on push services for 24h so devices that
        // come back online still receive it (default TTL is ~0 = drop instantly).
        TTL: 60 * 60 * 24,
        urgency: "high",
        // Topic lets push services collapse same-topic notifications.
        // Must be URL-safe base64, max 32 chars. Hash the tag.
        ...(payload.tag ? { topic: makeTopic(payload.tag) } : {}),
      },
    );
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status;
    if (status === 410 || status === 404) {
      console.log(`[push] Removing expired subscription id=${sub.id} (HTTP ${status})`);
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
    } else if (status === 401) {
      console.error(`[push] VAPID auth error for sub id=${sub.id} — check VAPID keys. Body:`, err?.body ?? err?.message);
    } else if (status === 400) {
      console.error(`[push] Bad request for sub id=${sub.id}. Body:`, err?.body ?? err?.message);
    } else {
      console.error(`[push] Failed to send to sub id=${sub.id} (HTTP ${status}):`, err?.message ?? String(err));
    }
  }
}

export async function sendPushToUser(userId: number, payload: PushPayload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[push] Skipping sendPushToUser — VAPID not configured.");
    return;
  }
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  if (!subs.length) {
    console.log(`[push] No subscriptions for userId=${userId}`);
    return;
  }
  console.log(`[push] Sending to userId=${userId}, ${subs.length} sub(s), tag="${payload.tag}"`);
  await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));
}

export async function sendPushToRole(
  crecheId: number,
  role: "master_admin" | "creche_admin" | "staff" | "tutor",
  payload: PushPayload,
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[push] Skipping sendPushToRole — VAPID not configured.");
    return;
  }
  const users = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, role)));
  const userIds = users.map((u) => u.id);
  if (!userIds.length) {
    console.log(`[push] No users with role=${role} in crecheId=${crecheId}`);
    return;
  }
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  if (!subs.length) {
    console.log(`[push] No subscriptions for role=${role} in crecheId=${crecheId}`);
    return;
  }
  console.log(`[push] Sending to role=${role} crecheId=${crecheId}, ${subs.length} sub(s), tag="${payload.tag}"`);
  await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));
}

export async function sendPushToUsers(userIds: number[], payload: PushPayload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !userIds.length) {
    if (!userIds.length) return;
    console.warn("[push] Skipping sendPushToUsers — VAPID not configured.");
    return;
  }
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  if (!subs.length) {
    console.log(`[push] No subscriptions for userIds=[${userIds.join(",")}]`);
    return;
  }
  console.log(`[push] Sending to ${userIds.length} user(s), ${subs.length} sub(s), tag="${payload.tag}"`);
  await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));
}
