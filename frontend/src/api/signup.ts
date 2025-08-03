import { apiFetch, extractError } from "./client";

export async function startSignup(email: string, password: string): Promise<{ signupId: string }> {
  const res = await apiFetch("/signup/start", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function verifySignup(
  signupId: string,
  verificationCode: string,
): Promise<{ userId: string }> {
  const res = await apiFetch("/signup/verify", {
    method: "POST",
    body: JSON.stringify({ signupId, verificationCode }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
