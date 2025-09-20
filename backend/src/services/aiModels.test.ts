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
    if (sql.includes("WHERE name = $1")) {
      const row = this.rows.find((r) => r.name === params?.[0]);
      const out = row ? [row] : [];
      return { rows: out, rowCount: out.length };
    }
    return { rows: this.rows, rowCount: this.rows.length };
  }
}

describe("AIModelsService", () => {
  const aiModels = [
    {
      name: "gpt-4.0",
      description: "OpenAI GPT-4.0 model",
      input_cost: 0.03,
      output_cost: 0.06,
    },
    {
      name: "gpt-3.5",
      description: "OpenAI GPT-3.5 model",
      input_cost: 0.002,
      output_cost: 0.002,
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
    expect(models[0].name).toBe("gpt-4.0");
    expect(models[1].inputCost).toBe(0.002);
  });

  it("should get an AI model by name", async () => {
    const model = await service.getAIModel("gpt-4.0");
    expect(model).not.toBeNull();
    expect(model?.description).toBe("OpenAI GPT-4.0 model");
    expect(model?.inputCost).toBe(0.03);
  });

  it("should return null if model not found", async () => {
    const model = await service.getAIModel("does-not-exist");
    expect(model).toBeNull();
  });
});
