import { Router, Request } from "express";
import { db } from "@workspace/db";
import { vaccinesTable, medicationsTable, incidentsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

// ---------------------------------------------------------
// VACCINES
// ---------------------------------------------------------

router.get("/vaccines/:petId", async (req: AuthRequest, res) => {
  try {
    const crecheId = req.user!.crecheId!;
    const petId = parseInt(req.params.petId);
    
    // Admin/staff and tutor can see vaccines
    const vaccines = await db.select()
      .from(vaccinesTable)
      .where(and(eq(vaccinesTable.crecheId, crecheId), eq(vaccinesTable.petId, petId)))
      .orderBy(desc(vaccinesTable.appliedDate));

    res.json(vaccines);
  } catch (error) {
    console.error("Error fetching vaccines:", error);
    res.status(500).json({ error: "Failed to fetch vaccines" });
  }
});

router.post("/vaccines", async (req: AuthRequest, res) => {
  try {
    const crecheId = req.user!.crecheId!;
    const { petId, name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl } = req.body;

    if (!petId || !name || !appliedDate) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [vaccine] = await db.insert(vaccinesTable).values({
      crecheId,
      petId,
      name,
      appliedDate: typeof appliedDate === "string" ? appliedDate : new Date(appliedDate).toISOString().split('T')[0],
      nextDueDate: nextDueDate ? (typeof nextDueDate === "string" ? nextDueDate : new Date(nextDueDate).toISOString().split('T')[0]) : null,
      veterinarian,
      notes,
      receiptUrl: receiptUrl ?? null,
    }).returning();

    res.status(201).json(vaccine);
  } catch (error) {
    console.error("Error creating vaccine:", error);
    res.status(500).json({ error: "Failed to create vaccine" });
  }
});

router.post("/vaccines/:id/receipt", async (req: AuthRequest, res) => {
  try {
    const crecheId = req.user!.crecheId!;
    const vaccineId = parseInt(req.params.id);
    const { receiptUrl } = req.body;

    if (!receiptUrl) return res.status(400).json({ error: "Missing receipt URL" });

    const [vaccine] = await db.update(vaccinesTable)
      .set({ receiptUrl })
      .where(and(eq(vaccinesTable.id, vaccineId), eq(vaccinesTable.crecheId, crecheId)))
      .returning();

    res.json(vaccine);
  } catch (error) {
    console.error("Error updating vaccine receipt:", error);
    res.status(500).json({ error: "Failed to update receipt" });
  }
});

// ---------------------------------------------------------
// MEDICATIONS (Staff & Admin only)
// ---------------------------------------------------------

router.get("/medications/:petId", async (req: AuthRequest, res) => {
  try {
    const crecheId = req.user!.crecheId!;
    const petIdStr = Array.isArray(req.params.petId) ? req.params.petId[0] : req.params.petId;
    const petId = parseInt(petIdStr as string);

    const medications = await db.select()
      .from(medicationsTable)
      .where(and(eq(medicationsTable.crecheId, crecheId), eq(medicationsTable.petId, petId)))
      .orderBy(desc(medicationsTable.startDate));

    res.json(medications);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch medications" });
  }
});

router.post("/medications", async (req: AuthRequest, res) => {
  try {
    if (req.user!.role === 'tutor') return res.status(403).json({ error: "Access denied" });
    const crecheId = req.user!.crecheId!;
    const { petId, name, dosage, frequency, startDate, endDate, times, notes } = req.body;

    const [medication] = await db.insert(medicationsTable).values({
      crecheId,
      petId,
      name,
      dosage,
      frequency,
      startDate: typeof startDate === "string" ? startDate : new Date(startDate).toISOString().split('T')[0],
      endDate: endDate ? (typeof endDate === "string" ? endDate : new Date(endDate).toISOString().split('T')[0]) : null,
      times: times || [],
      notes,
    }).returning();

    res.status(201).json(medication);
  } catch (error) {
    res.status(500).json({ error: "Failed to create medication" });
  }
});

// ---------------------------------------------------------
// INCIDENTS (Staff & Admin only)
// ---------------------------------------------------------

router.get("/incidents/:petId", async (req: AuthRequest, res) => {
  try {
    const crecheId = req.user!.crecheId!;
    const petIdStr = Array.isArray(req.params.petId) ? req.params.petId[0] : req.params.petId;
    const petId = parseInt(petIdStr as string);

    const incidents = await db.select()
      .from(incidentsTable)
      .where(and(eq(incidentsTable.crecheId, crecheId), eq(incidentsTable.petId, petId)))
      .orderBy(desc(incidentsTable.incidentDate));

    res.json(incidents);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

router.post("/incidents", async (req: AuthRequest, res) => {
  try {
    if (req.user!.role === 'tutor') {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const crecheId = req.user!.crecheId!;
    const { petId, description, severity, vetCalled, vetName, actionTaken } = req.body;

    const [incident] = await db.insert(incidentsTable).values({
      crecheId,
      petId,
      description,
      severity,
      vetCalled: vetCalled || false,
      vetName,
      actionTaken,
      reportedBy: req.user!.id.toString(), // Store user ID
    }).returning();

    res.status(201).json(incident);
  } catch (error) {
    res.status(500).json({ error: "Failed to create incident" });
  }
});

export default router;
