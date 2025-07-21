import { apiFetch, extractError } from "./client";

export async function startSignup(email: string, password: string): Promise<{ signup_id: string }> {
  const res = await apiFetch("/signup/start", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function verifySignup(
  signup_id: string,
  verification_code: string,
): Promise<{ user_id: string }> {
  const res = await apiFetch("/signup/verify", {
    method: "POST",
    body: JSON.stringify({ signup_id, verification_code }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
