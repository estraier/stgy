import { AIModel } from "../models/aiModel";
import { Pool } from "pg";
import { pgQuery } from "../utils/servers";

export class AIModelsService {
  private pgPool: Pool;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  async getAIModel(name: string): Promise<AIModel | null> {
    const res = await pgQuery<{
      name: string;
      description: string;
      input_cost: number;
      output_cost: number;
    }>(
      this.pgPool,
      `SELECT name, description, input_cost, output_cost FROM ai_models WHERE name = $1`,
      [name],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      name: row.name,
      description: row.description,
      inputCost: row.input_cost,
      outputCost: row.output_cost,
    };
  }

  async listAIModels(): Promise<AIModel[]> {
    const res = await pgQuery<{
      name: string;
      description: string;
      input_cost: number;
      output_cost: number;
    }>(this.pgPool, "SELECT name, description, input_cost, output_cost FROM ai_models", []);
    return res.rows.map((row) => ({
      name: row.name,
      description: row.description,
      inputCost: row.input_cost,
      outputCost: row.output_cost,
    }));
  }
}
