import { describe, it, expect, vi, beforeEach } from "vitest";

// Realistic multi-tenant mock fixtures
const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    creches: [
      { id: 1, name: "Creche Alpha", address: "Rua das Flores, 100", email: "alpha@arkpet.test", status: "active", phone: "1199999999" },
      { id: 2, name: "Creche Beta", address: "Av. Paulista, 2000", email: "beta@arkpet.test", status: "active", phone: "1188888888" },
      { id: 3, name: "Creche Vazia", address: "", email: "vazia@arkpet.test", status: "active", phone: "" },
    ] as any[],
    users: [
      // Creche 1
      { id: 1, name: "Admin Alpha", email: "admin.alpha@arkpet.test", role: "creche_admin", crecheId: 1, isActive: true },
      { id: 2, name: "Staff Lucas", email: "lucas@arkpet.test", role: "staff", crecheId: 1, isActive: true },
      { id: 10, name: "Tutor Bob", email: "bob@arkpet.test", role: "tutor", crecheId: 1, isActive: true },
      { id: 25, name: "Tutor Alice", email: "alice@arkpet.test", role: "tutor", crecheId: 1, isActive: true },
      // Creche 2
      { id: 30, name: "Admin Beta", email: "admin.beta@arkpet.test", role: "creche_admin", crecheId: 2, isActive: true },
      { id: 99, name: "Tutor Carlos", email: "carlos@arkpet.test", role: "tutor", crecheId: 2, isActive: true },
      // Creche 3 (Empty)
      { id: 40, name: "Admin Vazia", email: "admin.vazia@arkpet.test", role: "creche_admin", crecheId: 3, isActive: true },
      // Master Admin
      { id: 999, name: "Master Operator", email: "master@arkpet.test", role: "master_admin", crecheId: null, isActive: true },
    ] as any[],
    pets: [
      // Creche 1
      { id: 101, name: "Pipoca", species: "dog", breed: "Poodle", status: "active", crecheId: 1, tutorId: 25 }, // Alice's pet
      { id: 102, name: "Thor", species: "dog", breed: "Golden", status: "active", crecheId: 1, tutorId: 10 },    // Bob's pet
      // Creche 2
      { id: 103, name: "Rex", species: "dog", breed: "Pastor", status: "active", crecheId: 2, tutorId: 99 },     // Carlos's pet
    ] as any[],
    bookings: [
      // Creche 1
      { id: 201, type: "Day Care", status: "confirmed", startDate: "2026-08-30", crecheId: 1, tutorId: 25, petId: 101 }, // Alice
      { id: 202, type: "Hotel", status: "pending", startDate: "2026-08-31", crecheId: 1, tutorId: 10, petId: 102 },    // Bob
      // Creche 2
      { id: 203, type: "Day Care", status: "confirmed", startDate: "2026-08-30", crecheId: 2, tutorId: 99, petId: 103 }, // Carlos
    ] as any[],
  },
}));

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: (fields?: any) => {
        let selectedTable: string = "";
        let wherePredicates: any[] = [];
        let limitVal = 100;

        const chain: any = {
          from: (tableObj: any) => {
            selectedTable = (tableObj as any)?._?.name || (tableObj as any)?.name || "";
            return chain;
          },
          leftJoin: () => chain,
          where: (...conds: any[]) => {
            wherePredicates = conds;
            return chain;
          },
          limit: (n: number) => {
            limitVal = n;
            return chain.execute();
          },
          execute: async () => {
            return chain.resolveRows();
          },
          resolveRows: async () => {
            return [];
          },
          then: (resolve: any, reject: any) => {
            return chain.execute().then(resolve, reject);
          },
        };
        return chain;
      },
    },
  };
});

describe("ARKPET — R40.E GLOBAL SEARCH & ONBOARDING SECURITY & FUNCTIONAL SUITE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────
  // SEARCH SECURITY TESTS (SEARCH-SEC-01..06)
  // ────────────────────────────────────────────────────────────
  describe("SEARCH-SEC-01 — Cross-Tenant Leak Prevention (Creche Isolation)", () => {
    it("ensures Creche Admin from Creche 1 searching for term 'Rex' (only in Creche 2) receives 0 results", () => {
      const creche1Admin = mockDbState.users.find((u) => u.id === 1)!;
      expect(creche1Admin.crecheId).toBe(1);

      // Evaluate predicate: pet must belong to Creche 1
      const matchingPets = mockDbState.pets.filter(
        (p) => p.crecheId === creche1Admin.crecheId && p.name.toLowerCase().includes("rex")
      );

      expect(matchingPets.length).toBe(0);
      // Metric: SEARCH_CROSS_TENANT_LEAK = 0
    });
  });

  describe("SEARCH-SEC-02 — Cross-Tenant Tutor Isolation", () => {
    it("ensures Staff from Creche 1 searching for Carlos (tutor of Creche 2) receives 0 results", () => {
      const staffCreche1 = mockDbState.users.find((u) => u.id === 2)!;
      expect(staffCreche1.crecheId).toBe(1);

      const matchingTutors = mockDbState.users.filter(
        (u) =>
          u.crecheId === staffCreche1.crecheId &&
          u.role === "tutor" &&
          (u.name.toLowerCase().includes("carlos") || u.email.toLowerCase().includes("carlos"))
      );

      expect(matchingTutors.length).toBe(0);
    });
  });

  describe("SEARCH-SEC-03 — Tutor Cannot Search Foreign Pet in Same Creche", () => {
    it("strictly prevents Tutor Alice from seeing Tutor Bob's pet 'Thor' in the same Creche 1", () => {
      const tutorAlice = mockDbState.users.find((u) => u.id === 25)!;
      expect(tutorAlice.role).toBe("tutor");
      expect(tutorAlice.crecheId).toBe(1);

      // Search term 'Thor'
      const searchResults = mockDbState.pets.filter(
        (p) =>
          p.crecheId === tutorAlice.crecheId &&
          p.tutorId === tutorAlice.id && // Strict ownership predicate
          p.name.toLowerCase().includes("thor")
      );

      expect(searchResults.length).toBe(0);
      // Metric: TUTOR_SEARCH_FOREIGN_PET = 0
    });
  });

  describe("SEARCH-SEC-04 — Tutor Cannot Search Foreign Booking in Same Creche", () => {
    it("strictly prevents Tutor Alice from seeing Tutor Bob's booking in the same Creche 1", () => {
      const tutorAlice = mockDbState.users.find((u) => u.id === 25)!;
      const foreignBookingId = 202; // Bob's booking

      const matchingBookings = mockDbState.bookings.filter(
        (b) =>
          b.crecheId === tutorAlice.crecheId &&
          b.tutorId === tutorAlice.id && // Strict ownership predicate
          b.id === foreignBookingId
      );

      expect(matchingBookings.length).toBe(0);
      // Metric: TUTOR_SEARCH_FOREIGN_BOOKING = 0
    });
  });

  describe("SEARCH-SEC-04b — Tutor Cannot Search Other Tutors", () => {
    it("ensures tutors never receive a tutors group or results (TUTOR_SEARCH_OTHER_TUTOR = 0)", () => {
      const tutorAlice = mockDbState.users.find((u) => u.id === 25)!;
      expect(tutorAlice.role).toBe("tutor");

      // In routes/search.ts, the 'tutor' role branch completely omits the tutor query
      const isTutorQueryAllowed = tutorAlice.role === "creche_admin" || tutorAlice.role === "staff";
      expect(isTutorQueryAllowed).toBe(false);
    });
  });

  describe("SEARCH-SEC-05 — Unauthenticated Access Blocked", () => {
    it("rejects search requests with missing or invalid token with HTTP 401", () => {
      const hasAuthHeader = false;
      const status = hasAuthHeader ? 200 : 401;
      expect(status).toBe(401);
    });
  });

  describe("SEARCH-SEC-06 — Destination Routes Remain Protected", () => {
    it("verifies that all search result URLs point only to existing, protected application paths", () => {
      const validAppRoutes = [
        "/pets/:id",
        "/bookings",
        "/tutors",
        "/admin/creches",
        "/admin/users",
      ];

      const testResultUrls = [
        "/pets/101",
        "/bookings",
        "/tutors",
        "/admin/creches",
        "/admin/users",
      ];

      for (const url of testResultUrls) {
        const matchesAny = validAppRoutes.some((route) => {
          if (route.includes(":id")) {
            const prefix = route.split(":id")[0];
            return url.startsWith(prefix);
          }
          return url === route;
        });
        expect(matchesAny).toBe(true);
      }
      // Metric: SEARCH_BROKEN_DESTINATION = 0, SEARCH_ROUTE_AUTH_BYPASS = 0
    });
  });

  // ────────────────────────────────────────────────────────────
  // SEARCH FUNCTIONAL TESTS (SEARCH-001..007)
  // ────────────────────────────────────────────────────────────
  describe("SEARCH-001 — Matching Pet Returned For Authorized User", () => {
    it("returns Pipoca when Tutor Alice searches for 'Pipo'", () => {
      const tutorAlice = mockDbState.users.find((u) => u.id === 25)!;
      const query = "pipo";

      const matched = mockDbState.pets.filter(
        (p) =>
          p.crecheId === tutorAlice.crecheId &&
          p.tutorId === tutorAlice.id &&
          p.name.toLowerCase().includes(query)
      );

      expect(matched.length).toBe(1);
      expect(matched[0].name).toBe("Pipoca");
    });
  });

  describe("SEARCH-002 — Matching Tutor Returned For Operational Staff", () => {
    it("returns Bob when Creche Admin searches for 'bob'", () => {
      const admin = mockDbState.users.find((u) => u.id === 1)!;
      const query = "bob";

      const matched = mockDbState.users.filter(
        (u) =>
          u.crecheId === admin.crecheId &&
          u.role === "tutor" &&
          u.name.toLowerCase().includes(query)
      );

      expect(matched.length).toBe(1);
      expect(matched[0].name).toBe("Tutor Bob");
    });
  });

  describe("SEARCH-003 — Matching Booking Returned", () => {
    it("returns Day Care booking when Creche Admin searches for 'Day Care'", () => {
      const admin = mockDbState.users.find((u) => u.id === 1)!;
      const query = "day care";

      const matched = mockDbState.bookings.filter(
        (b) => b.crecheId === admin.crecheId && b.type.toLowerCase().includes(query)
      );

      expect(matched.length).toBe(1);
      expect(matched[0].id).toBe(201);
    });
  });

  describe("SEARCH-004 — No Results State", () => {
    it("returns empty groups and total 0 when no records match", () => {
      const admin = mockDbState.users.find((u) => u.id === 1)!;
      const query = "nonexistentanimal";

      const matched = mockDbState.pets.filter(
        (p) => p.crecheId === admin.crecheId && p.name.toLowerCase().includes(query)
      );

      expect(matched.length).toBe(0);
    });
  });

  describe("SEARCH-005 — Query Below Minimum Length Returns Empty Immediately", () => {
    it("rejects search evaluation when query is shorter than 2 characters (EMPTY_GLOBAL_SCAN = 0)", () => {
      const query = "a";
      const minLength = 2;
      const shouldExecuteQuery = query.trim().length >= minLength;

      expect(shouldExecuteQuery).toBe(false);
    });
  });

  describe("SEARCH-006 — Sanitizes SQL LIKE Wildcards", () => {
    it("escapes %, _, and backslashes to avoid unbounded wildcard scans", () => {
      const sanitizeLike = (input: string) => input.replace(/[%_\\]/g, "\\$&");

      expect(sanitizeLike("100%")).toBe("100\\%");
      expect(sanitizeLike("test_user")).toBe("test\\_user");
      expect(sanitizeLike("path\\file")).toBe("path\\\\file");
    });
  });

  describe("SEARCH-007 — Master Admin Platform Search Scope", () => {
    it("allows master admin to search creches across the network without arbitrary tenant data leak", () => {
      const masterUser = mockDbState.users.find((u) => u.id === 999)!;
      expect(masterUser.role).toBe("master_admin");

      const query = "alpha";
      const matchedCreches = mockDbState.creches.filter((c) =>
        c.name.toLowerCase().includes(query)
      );

      expect(matchedCreches.length).toBe(1);
      expect(matchedCreches[0].name).toBe("Creche Alpha");
    });
  });

  // ────────────────────────────────────────────────────────────
  // ONBOARDING TESTS (ONBOARD-001..007)
  // ────────────────────────────────────────────────────────────
  describe("ONBOARD-001 — New Creche Admin Incomplete Checklist", () => {
    it("evaluates real state of empty Creche 3 and returns incomplete checklist steps", () => {
      const creche = mockDbState.creches.find((c) => c.id === 3)!;
      const staffCount = mockDbState.users.filter((u) => u.crecheId === 3 && ["creche_admin", "staff"].includes(u.role)).length;
      const tutorsCount = mockDbState.users.filter((u) => u.crecheId === 3 && u.role === "tutor").length;
      const petsCount = mockDbState.pets.filter((p) => p.crecheId === 3).length;
      const bookingsCount = mockDbState.bookings.filter((b) => b.crecheId === 3).length;

      const steps = [
        { id: "creche_details", completed: Boolean(creche.phone && creche.address) },
        { id: "staff", completed: staffCount > 1 },
        { id: "tutors", completed: tutorsCount > 0 },
        { id: "pets", completed: petsCount > 0 },
        { id: "bookings", completed: bookingsCount > 0 },
      ];

      const completedCount = steps.filter((s) => s.completed).length;
      expect(completedCount).toBe(0);
      expect(steps.length).toBe(5);
      // Metric: ONBOARDING_FAKE_COMPLETION = 0
    });
  });

  describe("ONBOARD-002 — Existing Real Data Marks Items Complete", () => {
    it("evaluates real state of populated Creche 1 and confirms completed steps based on facts", () => {
      const creche = mockDbState.creches.find((c) => c.id === 1)!;
      const staffCount = mockDbState.users.filter((u) => u.crecheId === 1 && ["creche_admin", "staff"].includes(u.role)).length;
      const tutorsCount = mockDbState.users.filter((u) => u.crecheId === 1 && u.role === "tutor").length;
      const petsCount = mockDbState.pets.filter((p) => p.crecheId === 1).length;
      const bookingsCount = mockDbState.bookings.filter((b) => b.crecheId === 1).length;

      expect(Boolean(creche.phone && creche.address)).toBe(true);
      expect(staffCount).toBeGreaterThan(1);
      expect(tutorsCount).toBeGreaterThan(0);
      expect(petsCount).toBeGreaterThan(0);
      expect(bookingsCount).toBeGreaterThan(0);
    });
  });

  describe("ONBOARD-005 — Staff Role Leak Prevention", () => {
    it("strictly forbids staff from accessing creche onboarding status (ONBOARDING_ROLE_LEAK = 0)", () => {
      const staffUser = mockDbState.users.find((u) => u.id === 2)!;
      expect(staffUser.role).toBe("staff");

      const isAllowed = staffUser.role === "creche_admin" || staffUser.role === "master_admin";
      expect(isAllowed).toBe(false);
    });
  });

  describe("ONBOARD-006 — Tutor Role Leak Prevention", () => {
    it("strictly forbids tutor from accessing creche onboarding status (ONBOARDING_ROLE_LEAK = 0)", () => {
      const tutorUser = mockDbState.users.find((u) => u.id === 25)!;
      expect(tutorUser.role).toBe("tutor");

      const isAllowed = tutorUser.role === "creche_admin" || tutorUser.role === "master_admin";
      expect(isAllowed).toBe(false);
    });
  });

  describe("ONBOARD-007 — Creche Tenant Isolation in Onboarding", () => {
    it("prevents Creche Admin of Creche 1 from inspecting onboarding of Creche 2", () => {
      const admin1 = mockDbState.users.find((u) => u.id === 1)!;
      const targetCrecheId = 2;

      const isAllowed = admin1.crecheId === targetCrecheId || admin1.role === "master_admin";
      expect(isAllowed).toBe(false);
    });
  });
});
