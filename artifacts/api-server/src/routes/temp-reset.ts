/**
 * TEMPORARY — delete this file after use.
 * One-shot database reset endpoint for production test cleanup.
 */
import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

const RESET_TOKEN = "xK9mP2qR7vN4wL8jY3hD6tF1cB5sA0eU";

router.post("/_reset_db", async (req, res) => {
  if (req.headers["x-reset-token"] !== RESET_TOKEN) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    await pool.query(`
      TRUNCATE TABLE
        booking_consumables, booking_credits, bookings,
        catalogue_items, catalogue_stock_transactions, chat_messages,
        creches, expenses, financial_audit_logs, invoice_items, invoices,
        medical_incidents, medications, order_items, orders,
        password_reset_tokens, pets, plan_prices, plans,
        push_subscriptions, subscriptions, tasks, timeline_comments,
        timeline_event_pets, timeline_events, timeline_likes, timeline_views,
        transactions, tutor_credits, tutor_service_credits,
        users, vaccines, walks
      RESTART IDENTITY CASCADE
    `);
    console.log("[TEMP RESET] Production database wiped.");
    res.json({ ok: true, message: "Database cleared." });
  } catch (err: any) {
    console.error("[TEMP RESET] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
