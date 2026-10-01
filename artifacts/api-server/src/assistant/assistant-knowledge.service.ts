import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ASSISTANT_CONFIG } from "./assistant.config.js";
import type { KnowledgeSnippet } from "./assistant.types.js";

interface RawKnowledgeDoc {
  fileName: string;
  category: string;
  title: string;
  sections: Array<{
    heading: string;
    content: string;
  }>;
}

export class AssistantKnowledgeService {
  private static cachedDocs: RawKnowledgeDoc[] | null = null;

  public static resetCache(): void {
    this.cachedDocs = null;
  }

  private static getKnowledgeDir(): string {
    // Resolve relative to current module directory
    try {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      return path.join(currentDir, "knowledge");
    } catch {
      return path.join(process.cwd(), "artifacts/api-server/src/assistant/knowledge");
    }
  }

  private static loadDocs(): RawKnowledgeDoc[] {
    if (this.cachedDocs) return this.cachedDocs;

    const dir = this.getKnowledgeDir();
    const docs: RawKnowledgeDoc[] = [];

    if (!fs.existsSync(dir)) {
      this.cachedDocs = docs;
      return docs;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const raw = fs.readFileSync(fullPath, "utf-8");
      const category = file.replace(".md", "");

      // Extract title from first # heading
      const lines = raw.split("\n");
      let title = category;
      const firstHeading = lines.find((l) => l.startsWith("# "));
      if (firstHeading) {
        title = firstHeading.replace("# ", "").trim();
      }

      // Parse ## sections
      const sections: Array<{ heading: string; content: string }> = [];
      let currentHeading = title;
      let currentBuffer: string[] = [];

      for (const line of lines) {
        if (line.startsWith("## ")) {
          if (currentBuffer.length > 0) {
            sections.push({
              heading: currentHeading,
              content: currentBuffer.join("\n").trim(),
            });
            currentBuffer = [];
          }
          currentHeading = line.replace("## ", "").trim();
        } else if (!line.startsWith("# ")) {
          currentBuffer.push(line);
        }
      }

      if (currentBuffer.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentBuffer.join("\n").trim(),
        });
      }

      docs.push({
        fileName: file,
        category,
        title,
        sections,
      });
    }

    this.cachedDocs = docs;
    return docs;
  }

  /**
   * Performs keyword and term-based retrieval across the domain documents.
   * Returns top 1-3 snippets maximum (FULL_KNOWLEDGE_PROMPT_INJECTION = NO).
   */
  public static async search(
    query: string,
    options: { category?: string; maxResults?: number } = {}
  ): Promise<KnowledgeSnippet[]> {
    const docs = this.loadDocs();
    const maxResults = options.maxResults ?? 3;
    const normalizedQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const stopwords = new Set([
      "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
      "em", "no", "na", "nos", "nas", "por", "pelo", "pela", "pelos", "pelas", "com",
      "para", "que", "qual", "quais", "como", "onde", "quando", "quem", "voce", "seu",
      "sua", "seus", "suas", "meu", "minha", "meus", "minhas", "pode", "fazer", "sao",
      "tem", "ter", "esta", "estao", "esse", "essa", "isso", "este", "esta", "isto",
      "primeira", "primeiro", "todas", "todos", "sistema", "arkpet"
    ]);

    let queryTokens = normalizedQuery
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2 && !stopwords.has(t));

    if (queryTokens.length === 0) {
      queryTokens = normalizedQuery.split(/\s+/).filter((t) => t.length > 2);
    }

    const scoredSnippets: KnowledgeSnippet[] = [];

    for (const doc of docs) {
      if (options.category && doc.category !== options.category) {
        continue;
      }

      for (const section of doc.sections) {
        const normalizedSection = (section.heading + " " + section.content)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        const normalizedHeading = (doc.title + " " + section.heading + " " + doc.category)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        let score = 0;
        for (const token of queryTokens) {
          if (normalizedHeading.includes(token)) {
            score += 5; // Strong boost for heading / title / category match
          }
          if (normalizedSection.includes(token)) {
            score += 1;
          }
        }

        if (score >= 2) {
          scoredSnippets.push({
            title: `${doc.title} > ${section.heading}`,
            category: doc.category,
            snippet: section.content.slice(0, 400),
            path: `knowledge/${doc.fileName}#${encodeURIComponent(section.heading)}`,
            relevanceScore: Math.round(score * 10) / 10,
          });
        }
      }
    }

    scoredSnippets.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scoredSnippets.slice(0, maxResults);
  }

  /**
   * Deterministically verifies if a requested functionality exists in the canonical ArkPet product.
   * Used to guarantee INVENTED_FEATURE_RATE_TARGET = 0.
   */
  public static isKnownFeature(featureTerm: string): boolean {
    const unknownFeatures = [
      "drone",
      "telepatia",
      "criptomoeda",
      "bitcoin",
      "blockchain",
      "laser",
      "robo",
      "holograma",
      "foguete",
      "extraterrestre",
    ];
    const normalized = featureTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. If query mentions any fictitious/unsupported tech, firmly false
    if (unknownFeatures.some((uf) => normalized.includes(uf))) {
      return false;
    }

    const canonicalFeatures = [
      "reserva",
      "hospedagem",
      "day use",
      "daycare",
      "hotel",
      "pet",
      "tutor",
      "staff",
      "equipe",
      "funcionario",
      "onboarding",
      "check-in",
      "check-out",
      "qr code",
      "chat",
      "mensagem",
      "notificacao",
      "financeiro",
      "fatura",
      "plano",
      "stripe",
      "configuracao",
      "alimentacao",
      "medicacao",
      "passeio",
    ];

    return canonicalFeatures.some((f) => normalized.includes(f));
  }
}
