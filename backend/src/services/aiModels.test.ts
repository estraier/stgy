import { AIModelsService } from "./aiModels";
import { Config } from "../config";

describe("AIModelsService", () => {
  const service = new AIModelsService();

  it("lists the configured AI model tiers", async () => {
    const models = await service.listAIModels();
    expect(models).toEqual([
      {
        label: "advanced",
        service: Config.AI_MODELS.advanced.service,
        chatModel: Config.AI_MODELS.advanced.chatModel,
      },
      {
        label: "balanced",
        service: Config.AI_MODELS.balanced.service,
        chatModel: Config.AI_MODELS.balanced.chatModel,
      },
      {
        label: "basic",
        service: Config.AI_MODELS.basic.service,
        chatModel: Config.AI_MODELS.basic.chatModel,
      },
    ]);
  });

  it("gets an AI model by tier", async () => {
    const model = await service.getAIModel("basic");
    expect(model).toEqual({
      label: "basic",
      service: Config.AI_MODELS.basic.service,
      chatModel: Config.AI_MODELS.basic.chatModel,
    });
  });

  it("returns null for an unknown tier", async () => {
    await expect(service.getAIModel("does-not-exist")).resolves.toBeNull();
  });
});
