import { AIModel } from "../models/aiModel";
import { Client } from "pg";

export class AIModelsService {
  private pgClient: Client;

  constructor(pgClient: Client) {
    this.pgClient = pgClient;
  }

  async getAIModel(name: string): Promise<AIModel | null> {
    const res = await this.pgClient.query(
      `SELECT name, description, input_cost, output_cost FROM ai_models WHERE name = $1`,
      [name],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      name: row.name,
      description: row.description,
      inputCost: row.input_cost,
      outputCost: row.output_cost,
    };
  }

  async listAIModels(): Promise<AIModel[]> {
    const res = await this.pgClient.query(
      "SELECT name, description, input_cost, output_cost FROM ai_models",
    );
    return res.rows.map((row) => ({
      name: row.name,
      description: row.description,
      inputCost: row.input_cost,
      outputCost: row.output_cost,
    }));
  }
}
