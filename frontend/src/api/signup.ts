import { apiFetch, extractError } from "./client";

type StartSignupOpts = {
  locale?: string;
  timezone?: string;
};

export async function startSignup(
  email: string,
  password: string,
  opts?: StartSignupOpts,
): Promise<{ signupId: string }> {
  let locale = opts?.locale;
  let timezone = opts?.timezone;
  if (typeof window !== "undefined") {
    if (!locale) {
      locale = (navigator.languages && navigator.languages[0]) || navigator.language;
    }
    if (!timezone) {
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {}
    }
  }
  const payload: {
    email: string;
    password: string;
    locale?: string;
    timezone?: string;
  } = { email, password };
  if (typeof locale === "string") payload.locale = locale;
  if (typeof timezone === "string") payload.timezone = timezone;
  const res = await apiFetch("/signup/start", {
    method: "POST",
    body: JSON.stringify(payload),
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
