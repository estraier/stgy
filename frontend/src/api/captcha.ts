import { apiFetch, extractError } from "./client";

export type CaptchaStatus = {
  valid: boolean;
  used: number;
  remaining: number;
};

export type CaptchaChallenge = {
  challengeId: string;
  image: string;
};

export async function getCaptchaStatus(): Promise<CaptchaStatus> {
  const res = await apiFetch("/captcha/status", { method: "GET" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function createCaptchaChallenge(): Promise<CaptchaChallenge> {
  const res = await apiFetch("/captcha/challenge", { method: "POST" });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function verifyCaptchaChallenge(
  challengeId: string,
  answer: string,
): Promise<{ passed: boolean; remaining: number }> {
  const res = await apiFetch("/captcha/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, answer }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function resetCaptchaPass(): Promise<void> {
  const res = await apiFetch("/captcha/pass", { method: "DELETE" });
  if (!res.ok) throw new Error(await extractError(res));
}
