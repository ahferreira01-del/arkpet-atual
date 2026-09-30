import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, usersTable } from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@arkpet.com.br";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log("[push] VAPID configured.");
  } catch (err: any) {
    console.warn("[push] VAPID configuration warning:", err?.message || err);
  }
} else {
  console.warn("[push] VAPID keys missing — push notifications disabled.");
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  bypassDedup?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory sliding window deduplication cache (5 minutes)
// Prevents duplicate push notifications for identical events (DUPLICATE_NOTIFICATION_FOR_SAME_EVENT = 0)
// ─────────────────────────────────────────────────────────────────────────────
const dedupCache = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes sliding window

export function isPushDuplicate(key: string): boolean {
  const now = Date.now();
  const expiresAt = dedupCache.get(key);
  if (expiresAt && expiresAt > now) {
    return true;
  }
  dedupCache.set(key, now + DEDUP_TTL_MS);
  return false;
}

export function clearPushDedupCache(): void {
  dedupCache.clear();
}

const dedupCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of dedupCache.entries()) {
    if (expiresAt <= now) {
      dedupCache.delete(key);
    }
  }
}, 10 * 60 * 1000);
if (dedupCleanupTimer.unref) {
  dedupCleanupTimer.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe structured audit logging (never logs passwords, tokens, CPF, or medical data)
// ─────────────────────────────────────────────────────────────────────────────
export interface PushAuditRecord {
  timestamp: string;
  eventType: string;
  recipientId: number | string;
  subCount?: number;
  tag?: string;
  status: "QUEUED" | "SENT" | "FAILED" | "DEDUP_SKIPPED" | "NO_SUBS" | "VAPID_MISSING";
  errorCode?: number | string;
}

export function logPushAudit(record: Omit<PushAuditRecord, "timestamp">): void {
  const fullRecord: PushAuditRecord = {
    timestamp: new Date().toISOString(),
    ...record,
  };
  console.log(`[push-audit] ${JSON.stringify(fullRecord)}`);
}

async function sendToSubscription(
  sub: { id: number; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<{ success: boolean; status?: number; error?: string }> {
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
        // come back online still receive it.
        TTL: 60 * 60 * 24,
        urgency: "high",
      },
    );
    return { success: true, status: 201 };
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
    return { success: false, status, error: err?.message ?? String(err) };
  }
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  const eventType = String(payload.data?.type || "generic");
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logPushAudit({ recipientId: userId, eventType, tag: payload.tag, status: "VAPID_MISSING" });
    return;
  }

  // Deduplication check
  if (!payload.bypassDedup && payload.data?.type !== "test") {
    const dedupKey = `user:${userId}:${payload.tag || `${payload.title}:${payload.body}`}`;
    if (isPushDuplicate(dedupKey)) {
      logPushAudit({ recipientId: userId, eventType, tag: payload.tag, status: "DEDUP_SKIPPED" });
      return;
    }
  }

  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  if (!subs.length) {
    logPushAudit({ recipientId: userId, eventType, subCount: 0, tag: payload.tag, status: "NO_SUBS" });
    return;
  }

  const results = await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));
  const failedCount = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length;

  logPushAudit({
    recipientId: userId,
    eventType,
    subCount: subs.length,
    tag: payload.tag,
    status: failedCount === subs.length ? "FAILED" : "SENT",
    errorCode: failedCount > 0 ? `${failedCount}/${subs.length}_failed` : undefined,
  });
}

export async function sendPushToRole(
  crecheId: number,
  role: "master_admin" | "creche_admin" | "staff" | "tutor",
  payload: PushPayload,
): Promise<void> {
  const eventType = String(payload.data?.type || "generic");
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logPushAudit({ recipientId: `role:${role}:${crecheId}`, eventType, tag: payload.tag, status: "VAPID_MISSING" });
    return;
  }

  // Deduplication check per role per creche
  if (!payload.bypassDedup && payload.data?.type !== "test") {
    const dedupKey = `role:${crecheId}:${role}:${payload.tag || `${payload.title}:${payload.body}`}`;
    if (isPushDuplicate(dedupKey)) {
      logPushAudit({ recipientId: `role:${role}:${crecheId}`, eventType, tag: payload.tag, status: "DEDUP_SKIPPED" });
      return;
    }
  }

  const users = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.crecheId, crecheId),
      eq(usersTable.role, role),
      eq(usersTable.isActive, true),
    ));
  const userIds = users.map((u) => u.id);
  if (!userIds.length) {
    logPushAudit({ recipientId: `role:${role}:${crecheId}`, eventType, subCount: 0, tag: payload.tag, status: "NO_SUBS" });
    return;
  }
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, userIds));
  if (!subs.length) {
    logPushAudit({ recipientId: `role:${role}:${crecheId}`, eventType, subCount: 0, tag: payload.tag, status: "NO_SUBS" });
    return;
  }

  const results = await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));
  const failedCount = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length;

  logPushAudit({
    recipientId: `role:${role}:${crecheId}`,
    eventType,
    subCount: subs.length,
    tag: payload.tag,
    status: failedCount === subs.length ? "FAILED" : "SENT",
    errorCode: failedCount > 0 ? `${failedCount}/${subs.length}_failed` : undefined,
  });
}

export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  if (!userIds.length) return;
  const eventType = String(payload.data?.type || "generic");
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logPushAudit({ recipientId: `users:[${userIds.join(",")}]`, eventType, tag: payload.tag, status: "VAPID_MISSING" });
    return;
  }

  // Filter to active users only
  const activeUsers = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      inArray(usersTable.id, userIds),
      eq(usersTable.isActive, true),
    ));
  const activeUserIds = activeUsers.map((u) => u.id);
  if (!activeUserIds.length) {
    logPushAudit({ recipientId: `users:[${userIds.join(",")}]`, eventType, subCount: 0, tag: payload.tag, status: "NO_SUBS" });
    return;
  }

  // Deduplication check per target user
  const targetUserIds: number[] = [];
  for (const uid of activeUserIds) {
    if (!payload.bypassDedup && payload.data?.type !== "test") {
      const dedupKey = `user:${uid}:${payload.tag || `${payload.title}:${payload.body}`}`;
      if (isPushDuplicate(dedupKey)) {
        logPushAudit({ recipientId: uid, eventType, tag: payload.tag, status: "DEDUP_SKIPPED" });
        continue;
      }
    }
    targetUserIds.push(uid);
  }

  if (!targetUserIds.length) return;

  const subs = await db.select().from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, targetUserIds));
  if (!subs.length) {
    logPushAudit({ recipientId: `users:[${targetUserIds.join(",")}]`, eventType, subCount: 0, tag: payload.tag, status: "NO_SUBS" });
    return;
  }

  const results = await Promise.allSettled(subs.map((sub) => sendToSubscription(sub, payload)));
  const failedCount = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length;

  logPushAudit({
    recipientId: `users:[${targetUserIds.join(",")}]`,
    eventType,
    subCount: subs.length,
    tag: payload.tag,
    status: failedCount === subs.length ? "FAILED" : "SENT",
    errorCode: failedCount > 0 ? `${failedCount}/${subs.length}_failed` : undefined,
  });
}
