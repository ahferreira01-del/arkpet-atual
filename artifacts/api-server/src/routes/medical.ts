import { Router } from "express";
import { db } from "@workspace/db";
import { vaccinesTable, medicationsTable, incidentsTable, petsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

/** Converte req.params que pode vir como string | string[] (mergeParams) */
function parseParamId(value: string | string[] | undefined): number {
  const str = Array.isArray(value) ? value[0] : (value ?? "");
  const id = parseInt(str, 10);
  return isNaN(id) ? NaN : id;
}

async function verifyPetAccess(crecheId: number, petId: number, user: AuthRequest["user"]): Promise<boolean> {
  const conditions = [eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)];
  if (user?.role === "tutor") {
    conditions.push(eq(petsTable.tutorId, user.id));
  }
  const [pet] = await db.select({ id: petsTable.id }).from(petsTable).where(and(...conditions)).limit(1);
  return !!pet;
}

// ---------------------------------------------------------
// VACCINES
// ---------------------------------------------------------

router.get("/vaccines/:petId", async (req: AuthRequest, res) => {
  try {
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const petId = parseParamId(req.params.petId);
    if (!petId || isNaN(petId) || petId <= 0) {
      res.status(400).json({ error: "petId inválido" });
      return;
    }

    // Validar que o pet existe e pertence a esta creche (e ao tutor se for role tutor)
    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Pet não encontrado" });
      return;
    }

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
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const { petId: rawPetId, name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl } = req.body;
    const petId = parseParamId(rawPetId);

    if (!petId || isNaN(petId) || petId <= 0 || !name || !appliedDate) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Pet não encontrado" });
      return;
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
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const vaccineId = parseParamId(req.params.id);
    if (!vaccineId || isNaN(vaccineId) || vaccineId <= 0) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }
    const { receiptUrl } = req.body;

    if (!receiptUrl) {
      res.status(400).json({ error: "Missing receipt URL" });
      return;
    }

    const [existingVaccine] = await db.select({
      id: vaccinesTable.id,
      petId: vaccinesTable.petId,
      crecheId: vaccinesTable.crecheId,
    })
      .from(vaccinesTable)
      .where(and(eq(vaccinesTable.id, vaccineId), eq(vaccinesTable.crecheId, crecheId)))
      .limit(1);

    if (!existingVaccine) {
      res.status(404).json({ error: "Vacina não encontrada" });
      return;
    }

    const hasAccess = await verifyPetAccess(crecheId, existingVaccine.petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Vacina não encontrada" });
      return;
    }

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
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const petId = parseParamId(req.params.petId);
    if (!petId || isNaN(petId) || petId <= 0) {
      res.status(400).json({ error: "petId inválido" });
      return;
    }

    // Validar que o pet existe e pertence a esta creche (e ao tutor se for role tutor)
    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Pet não encontrado" });
      return;
    }

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
    if (req.user!.role === 'tutor') {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const { petId: rawPetId, name, dosage, frequency, startDate, endDate, times, notes } = req.body;
    const petId = parseParamId(rawPetId);

    if (!petId || isNaN(petId) || petId <= 0 || !name || !dosage || !frequency || !startDate) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Pet não encontrado" });
      return;
    }

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

    // If pet is checked in, trigger today's task regeneration
    const [pet] = await db.select({ isCheckedIn: petsTable.isCheckedIn })
      .from(petsTable)
      .where(and(eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)))
      .limit(1);

    if (pet?.isCheckedIn) {
      import("../lib/scheduler.js")
        .then(({ generateTasksForPetToday }) => generateTasksForPetToday(petId, crecheId))
        .catch((err: unknown) => console.error("[medical] medication task regen failed:", err));
    }

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
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const petId = parseParamId(req.params.petId);
    if (!petId || isNaN(petId) || petId <= 0) {
      res.status(400).json({ error: "petId inválido" });
      return;
    }

    // Validar que o pet existe e pertence a esta creche (e ao tutor se for role tutor)
    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Pet não encontrado" });
      return;
    }

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
    const crecheId = parseParamId(req.params.crecheId);
    if (!crecheId || isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "crecheId inválido" });
      return;
    }
    const { petId: rawPetId, description, severity, vetCalled, vetName, actionTaken } = req.body;
    const petId = parseParamId(rawPetId);

    if (!petId || isNaN(petId) || petId <= 0 || !description || !severity) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) {
      res.status(404).json({ error: "Pet não encontrado" });
      return;
    }

    const [incident] = await db.insert(incidentsTable).values({
      crecheId,
      petId,
      description,
      severity,
      vetCalled: vetCalled || false,
      vetName,
      actionTaken,
      reportedBy: req.user!.id.toString(),
    }).returning();

    res.status(201).json(incident);
  } catch (error) {
    res.status(500).json({ error: "Failed to create incident" });
  }
});

export default router;
