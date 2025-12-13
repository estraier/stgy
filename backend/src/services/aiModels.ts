import { AIModel } from "../models/aiModel";
import { Pool } from "pg";
import { pgQuery } from "../utils/servers";

export class AIModelsService {
  private pgPool: Pool;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  async getAIModel(label: string): Promise<AIModel | null> {
    const res = await pgQuery<{
      label: string;
      service: string;
      chat_model: string;
      feature_model: string;
    }>(
      this.pgPool,
      `SELECT label, service, chat_model, feature_model FROM ai_models WHERE label = $1`,
      [label],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      label: row.label,
      service: row.service,
      chatModel: row.chat_model,
      featureModel: row.feature_model,
    };
  }

  async listAIModels(): Promise<AIModel[]> {
    const res = await pgQuery<{
      label: string;
      service: string;
      chat_model: string;
      feature_model: string;
    }>(
      this.pgPool,
      "SELECT label, service, chat_model, feature_model FROM ai_models ORDER BY label",
      [],
    );
    return res.rows.map((row) => ({
      label: row.label,
      service: row.service,
      chatModel: row.chat_model,
      featureModel: row.feature_model,
    }));
  }
}
