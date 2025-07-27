import { AIModel } from "../models/ai_model";
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
    return res.rows[0] || null;
  }

  async listAIModels(): Promise<AIModel[]> {
    const res = await this.pgClient.query(
      "SELECT name, description, input_cost, output_cost FROM ai_models",
    );
    return res.rows;
  }
}
