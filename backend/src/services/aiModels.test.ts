import { AIModelsService } from "./aiModels";

jest.mock("../utils/servers", () => ({
  pgQuery: jest.fn(async (pool: any, text: string, params?: any[]) => pool.query(text, params)),
}));

class MockPgPool {
  rows: any[];
  constructor(rows: any[] = []) {
    this.rows = rows;
  }
  async query(sql: string, params?: any[]) {
    if (sql.includes("WHERE label = $1")) {
      const row = this.rows.find((r) => r.label === params?.[0]);
      const out = row ? [row] : [];
      return { rows: out, rowCount: out.length };
    }
    if (sql.includes("ORDER BY label")) {
      const out = [...this.rows].sort((a, b) => String(a.label).localeCompare(String(b.label)));
      return { rows: out, rowCount: out.length };
    }
    return { rows: this.rows, rowCount: this.rows.length };
  }
}

describe("AIModelsService", () => {
  const aiModels = [
    {
      label: "advanced",
      service: "openai",
      chat_model: "gpt-5.1",
      feature_model: "text-embedding-3-large",
    },
    {
      label: "basic",
      service: "openai",
      chat_model: "gpt-5.1-nano",
      feature_model: "text-embedding-3-small",
    },
  ];

  let service: AIModelsService;
  let pgPool: MockPgPool;

  beforeEach(() => {
    pgPool = new MockPgPool([...aiModels]);
    service = new AIModelsService(pgPool as any);
  });

  it("should list all AI models", async () => {
    const models = await service.listAIModels();
    expect(models).toHaveLength(2);
    expect(models[0].chatModel).toBe("gpt-5.1");
    expect(models[0].featureModel).toBe("text-embedding-3-large");
    expect(models[1].chatModel).toBe("gpt-5.1-nano");
    expect(models[1].featureModel).toBe("text-embedding-3-small");
  });

  it("should get an AI model by label", async () => {
    const model = await service.getAIModel("basic");
    expect(model).not.toBeNull();
    expect(model?.service).toBe("openai");
    expect(model?.chatModel).toBe("gpt-5.1-nano");
    expect(model?.featureModel).toBe("text-embedding-3-small");
  });

  it("should return null if model not found", async () => {
    const model = await service.getAIModel("does-not-exist");
    expect(model).toBeNull();
  });
});
