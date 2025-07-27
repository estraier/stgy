import type { AIModel } from "./models";
import { apiFetch, extractError } from "./client";

export async function listAIModels(): Promise<AIModel[]> {
  const res = await apiFetch(`/ai-models`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function getAIModel(name: string): Promise<AIModel> {
  const res = await apiFetch(`/ai-models/${name}`, { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
