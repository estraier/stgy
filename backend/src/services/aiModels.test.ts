import { AIModelsService } from "./aiModels";

class MockPgClient {
  rows: any[];

  constructor(rows: any[] = []) {
    this.rows = rows;
  }

  async query(sql: string, params?: any[]) {
    if (sql.includes("WHERE name = $1")) {
      const row = this.rows.find((r) => r.name === params?.[0]);
      return { rows: row ? [row] : [] };
    }
    return { rows: this.rows };
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
  let pgClient: MockPgClient;

  beforeEach(() => {
    pgClient = new MockPgClient([...aiModels]);
    service = new AIModelsService(pgClient as any);
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
