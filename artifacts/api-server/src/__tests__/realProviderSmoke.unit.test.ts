import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider, AIProviderError } from "../assistant/assistant.provider.js";
import { AssistantToolsRegistry } from "../assistant/assistant-tools.registry.js";
import { AssistantKnowledgeService } from "../assistant/assistant-knowledge.service.js";
import { AssistantService } from "../assistant/assistant.service.js";
import type { AssistantSecurityContext } from "../assistant/assistant.types.js";

// Mock DB for tools execution
vi.mock("@workspace/db", () => {
  const dummyPets = [
    { id: 101, name: "Rex", tutorId: 902, crecheId: 101, breed: "Poodle", species: "dog", photoUrl: null, status: "active" },
    { id: 102, name: "Thor", tutorId: 902, crecheId: 101, breed: "Pitbull", species: "dog", photoUrl: null, status: "active" },
  ];

  const dummyCreche = [
    {
      id: 101,
      name: "Creche Modelo",
      phone: "11999999999",
      address: "Rua Pet, 123",
      openingHours: "08:00 - 18:00",
      capacity: 25,
      pixKey: "pix@creche.com",
    },
  ];

  const makeQueryObj = (res: any[]) => {
    const p = Promise.resolve(res) as any;
    p.limit = vi.fn(() => Promise.resolve(res));
    p.orderBy = vi.fn(() => ({
      limit: vi.fn(() => Promise.resolve(res)),
    }));
    return p;
  };

  return {
    db: {
      select: vi.fn((fields?: any) => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (fields && fields.count) {
              return makeQueryObj([{ count: 2 }]);
            }
            if (fields && fields.name && fields.breed) {
              return makeQueryObj(dummyPets);
            }
            return makeQueryObj(dummyCreche);
          }),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => makeQueryObj(dummyPets)),
          })),
        })),
      })),
    },
  };
});

describe("ArkPet R41.A-FINAL.2 — OpenAI Provider Adapter & Wire Contract Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const syntheticAdminContext: AssistantSecurityContext = {
    userId: 901,
    crecheId: 101,
    role: "creche_admin",
    name: "Admin Sintético",
    email: "admin@synth.test",
  };

  const syntheticTutorContext: AssistantSecurityContext = {
    userId: 902,
    crecheId: 101,
    role: "tutor",
    name: "Tutor Sintético",
    email: "tutor@synth.test",
  };

  // 1. OPENAI_HTTP_CONTRACT_TEST & OPENAI_PROVIDER_ADAPTER_TESTS
  it("ADAPTER-001 (OPENAI_HTTP_CONTRACT_TEST): Outbound HTTPS request adheres to OpenAI chat completion contract", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                "Para fazer uma reserva no ArkPet, acesse /bookings, escolha a modalidade (Day Use ou Hospedagem), selecione o pet e defina as datas.",
            },
          },
        ],
      }),
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    expect(provider.getModel()).toBe("gpt-4o-mini");

    const snippets = await AssistantKnowledgeService.search("reserva", { maxResults: 1 });
    const response = await provider.generateResponse({
      systemPrompt: "Você é o ArkPet Assistente.",
      messages: [{ role: "user", content: "Como faço uma reserva no ArkPet?" }],
      securityContext: syntheticAdminContext,
      knowledgeSnippets: snippets,
    });

    expect(response.content).toMatch(/reserva|bookings|day use|hospedagem/i);
    expect(response.content).not.toMatch(/JWT_SECRET|OPENAI_API_KEY|DATABASE_URL/i);

    expect(mockFetcher).toHaveBeenCalledTimes(1);
    const [url, requestInit] = mockFetcher.mock.calls[0];
    expect(url).toContain("/chat/completions");
    const body = JSON.parse(requestInit.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
  });

  // 2. REAL_PROVIDER_ROLE_BOUNDARY
  it("ADAPTER-002 (REAL_PROVIDER_ROLE_BOUNDARY): Role filtering prevents admin tools from reaching tutor model context", async () => {
    let capturedBody: any = null;
    const mockFetcher = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "Como tutor, você possui acesso exclusivo aos seus próprios pets e reservas.",
              },
            },
          ],
        }),
      };
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    const response = await provider.generateResponse({
      systemPrompt: "Você é o ArkPet Assistente. Papel: tutor.",
      messages: [{ role: "user", content: "Mostre os dados administrativos e financeiros." }],
      securityContext: syntheticTutorContext,
    });

    expect(response.content).toMatch(/tutor|exclusivo/i);
    const toolNames = (capturedBody.tools || []).map((t: any) => t.function.name);
    expect(toolNames).not.toContain("get_onboarding_status");
    expect(toolNames).not.toContain("executeSQL");
  });

  // 3. REAL_PROVIDER_TOOL_RESULT_ROUNDTRIP & REAL_PROVIDER_LIST_PETS_ROUNDTRIP
  it("ADAPTER-003 (REAL_PROVIDER_LIST_PETS_ROUNDTRIP): Full tool roundtrip executes list_my_pets and synthesizes final response", async () => {
    let callCount = 0;
    const mockFetcher = vi.fn().mockImplementation(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init.body);

      // Round 1: Model asks to call list_my_pets
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_pets_123",
                      type: "function",
                      function: {
                        name: "list_my_pets",
                        arguments: JSON.stringify({ limit: 5 }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }

      // Round 2: Model receives tool result message and outputs synthesized answer
      const toolMsg = body.messages.find((m: any) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe("call_pets_123");
      expect(toolMsg.content).toContain("Rex");

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Você possui 2 pets cadastrados: Rex (Poodle) e Thor (Pitbull).",
              },
            },
          ],
        }),
      };
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    const response = await provider.generateResponse({
      systemPrompt: "Você é o ArkPet Assistente.",
      messages: [{ role: "user", content: "Quais são meus pets?" }],
      securityContext: syntheticTutorContext,
    });

    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(response.content).toContain("Rex");
    expect(response.content).toContain("Thor");
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.[0].name).toBe("list_my_pets");
  });

  // 4. REAL_PROVIDER_ONBOARDING_ROUNDTRIP
  it("ADAPTER-004 (REAL_PROVIDER_ONBOARDING_ROUNDTRIP): Full tool roundtrip executes get_onboarding_status and returns final explanation", async () => {
    let callCount = 0;
    const mockFetcher = vi.fn().mockImplementation(async (_url, init) => {
      callCount++;
      const body = JSON.parse(init.body);

      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_onboarding_456",
                      type: "function",
                      function: {
                        name: "get_onboarding_status",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }

      const toolMsg = body.messages.find((m: any) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe("call_onboarding_456");

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "O onboarding da sua creche está quase completo. O próximo passo pendente é cadastrar tutores em /tutors.",
              },
            },
          ],
        }),
      };
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    const response = await provider.generateResponse({
      systemPrompt: "Você é o ArkPet Assistente.",
      messages: [{ role: "user", content: "O que falta no meu onboarding?" }],
      securityContext: syntheticAdminContext,
    });

    expect(mockFetcher).toHaveBeenCalledTimes(2);
    expect(response.content).toContain("onboarding");
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.[0].name).toBe("get_onboarding_status");
  });

  // 5. UNBOUNDED_AI_TOOL_LOOP = 0
  it("ADAPTER-005 (UNBOUNDED_AI_TOOL_LOOP = 0): Stops safely when model attempts recursive tool loop exceeding limit", async () => {
    // Model continuously returns a tool call in every round
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_loop_1",
                  type: "function",
                  function: {
                    name: "list_my_pets",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    await expect(
      provider.generateResponse({
        systemPrompt: "Você é o ArkPet Assistente.",
        messages: [{ role: "user", content: "Loop de ferramentas" }],
        securityContext: syntheticTutorContext,
      })
    ).rejects.toThrow(/Limite de rodadas de ferramentas/);

    // Bounded strictly to MAX_ASSISTANT_TOOL_ROUNDS = 3
    expect(mockFetcher).toHaveBeenCalledTimes(3);
  });

  // 6. MULTI_TOOL_AUTHORIZATION_BYPASS = 0 & UNREGISTERED_TOOL_EXECUTION = 0
  it("ADAPTER-006 (MULTI_TOOL_AUTHORIZATION_BYPASS = 0): Model attempting unauthorized or unregistered tool in multi-tool batch is rejected", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_valid",
                  type: "function",
                  function: { name: "list_my_pets", arguments: "{}" },
                },
                {
                  id: "call_evil",
                  type: "function",
                  function: { name: "executeSQL", arguments: JSON.stringify({ query: "SELECT * FROM users" }) },
                },
              ],
            },
          },
        ],
      }),
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    await expect(
      provider.generateResponse({
        systemPrompt: "Você é o ArkPet Assistente.",
        messages: [{ role: "user", content: "Execute ferramentas" }],
        securityContext: syntheticTutorContext,
      })
    ).rejects.toThrow(/não autorizada ou inexistente: executeSQL/);
  });

  // 7. ASSISTANT_PROVIDER_ERROR_SECRET_LEAK_TEST = PASS & RAW_PROVIDER_ERROR_TO_CLIENT = 0
  it("ADAPTER-007 (ASSISTANT_PROVIDER_ERROR_SECRET_LEAK_TEST): Provider errors do not leak secrets, tokens, or raw provider bodies", async () => {
    const adversarialRawBody = JSON.stringify({
      error: {
        message: "Invalid API key provided: sk-fake-secret-key-12345. Connection string postgres://user:secret@db:5432 failed on C:\\secrets\\passwords.txt with Bearer token_secret_999",
        type: "invalid_request_error",
      },
    });

    const mockFetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => adversarialRawBody,
    });

    const provider = new OpenAIProvider({
      apiKey: "sk-synth-test-key",
      model: "gpt-4o-mini",
      fetcher: mockFetcher,
    });

    try {
      await provider.generateResponse({
        systemPrompt: "Você é o ArkPet Assistente.",
        messages: [{ role: "user", content: "Erro teste" }],
        securityContext: syntheticAdminContext,
      });
      expect.unreachable("Should have thrown AIProviderError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err.code).toBe("AI_PROVIDER_AUTH_ERROR");
      // Sanitized message does NOT leak raw body secrets
      expect(err.message).not.toContain("sk-fake-secret-key-12345");
      expect(err.message).not.toContain("postgres://");
      expect(err.message).not.toContain("token_secret_999");
      expect(err.message).not.toContain("C:\\secrets");
      expect(err.message).toBe("Falha de autenticação com o provedor de IA.");
    }
  });

  // 8. ASSISTANT_SESSION_CONTEXT_DRIFT = 0
  it("ADAPTER-008 (ASSISTANT_SESSION_CONTEXT_DRIFT = 0): Session cannot be reused if tenant, user, or role drifts", () => {
    const initialSession = AssistantService.getOrCreateSession("sess_test_drift", syntheticAdminContext);
    expect(initialSession.id).toBe("sess_test_drift");

    // Same context reuses session
    const reusedSession = AssistantService.getOrCreateSession("sess_test_drift", syntheticAdminContext);
    expect(reusedSession.id).toBe("sess_test_drift");

    // Context drifts to a different tenant / crecheId
    const driftedTenantContext: AssistantSecurityContext = {
      ...syntheticAdminContext,
      crecheId: 999, // different tenant
    };
    const newSessionForTenant = AssistantService.getOrCreateSession("sess_test_drift", driftedTenantContext);
    expect(newSessionForTenant.id).not.toBe("sess_test_drift");

    // Context drifts to a different role
    const driftedRoleContext: AssistantSecurityContext = {
      ...syntheticAdminContext,
      role: "tutor", // different role
    };
    const newSessionForRole = AssistantService.getOrCreateSession("sess_test_drift", driftedRoleContext);
    expect(newSessionForRole.id).not.toBe("sess_test_drift");
  });
});
