import { Config } from "../config";
import { AI_MODEL_TIERS, isAIModelTier, type AIModel } from "../models/aiModel";

export class AIModelsService {
  async getAIModel(label: string): Promise<AIModel | null> {
    if (!isAIModelTier(label)) return null;
    const model = Config.AI_MODELS[label];
    return {
      label,
      service: model.service,
      chatModel: model.chatModel,
    };
  }

  async listAIModels(): Promise<AIModel[]> {
    return AI_MODEL_TIERS.map((label) => {
      const model = Config.AI_MODELS[label];
      return {
        label,
        service: model.service,
        chatModel: model.chatModel,
      };
    });
  }
}
