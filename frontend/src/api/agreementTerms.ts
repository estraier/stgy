import type { AgreementTerm } from "./models";
import { apiFetch, extractError } from "./client";

export class AgreementTermsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AgreementTermsApiError";
    this.status = status;
  }
}

async function throwAgreementTermsError(res: Response): Promise<never> {
  throw new AgreementTermsApiError(res.status, await extractError(res));
}

export async function getLatestAgreementTerm(): Promise<AgreementTerm> {
  const res = await apiFetch("/agreement-terms/latest", { method: "GET", cache: "no-store" });
  if (!res.ok) return throwAgreementTermsError(res);
  return res.json();
}

export async function getAgreementTerm(id: string): Promise<AgreementTerm> {
  const res = await apiFetch(`/agreement-terms/${encodeURIComponent(id)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) return throwAgreementTermsError(res);
  return res.json();
}

export async function agreeToAgreementTerm(id: string): Promise<{ result: string }> {
  const res = await apiFetch(`/users/agreement/${encodeURIComponent(id)}`, {
    method: "POST",
  });
  if (!res.ok) return throwAgreementTermsError(res);
  return res.json();
}
