"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSessionInfo, logout } from "@/api/auth";
import {
  AgreementTermsApiError,
  agreeToAgreementTerm,
  getAgreementTerm,
  getLatestAgreementTerm,
} from "@/api/agreementTerms";
import type { AgreementTerm, SessionInfo } from "@/api/models";
import {
  sanitizeAgreementReturnPath,
  selectAgreementContent,
} from "@/utils/agreement";

type PendingAction = "agree" | "cancel" | null;

export default function PageBody() {
  const searchParams = useSearchParams();
  const returnPath = useMemo(
    () => sanitizeAgreementReturnPath(searchParams.get("next")),
    [searchParams],
  );

  const [session, setSession] = useState<SessionInfo | null>(null);
  const [term, setTerm] = useState<AgreementTerm | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    (async () => {
      let currentSession: SessionInfo;
      try {
        currentSession = await getSessionInfo();
      } catch {
        if (!canceled) window.location.replace("/login");
        return;
      }
      if (canceled) return;

      if (currentSession.userIsAdmin || currentSession.requiredAgreementTermId === null) {
        window.location.replace(returnPath);
        return;
      }

      try {
        const currentTerm = await getAgreementTerm(
          currentSession.requiredAgreementTermId,
        );
        if (canceled) return;
        setSession(currentSession);
        setTerm(currentTerm);
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [returnPath]);

  const content = useMemo(
    () =>
      term && session
        ? selectAgreementContent(term.contents, session.userLocale)
        : null,
    [session, term],
  );

  async function handleAgree() {
    if (!term || !content) return;
    setPendingAction("agree");
    setError(null);
    setNotice(null);

    try {
      await agreeToAgreementTerm(term.id);
      window.location.replace(returnPath);
    } catch (err) {
      if (err instanceof AgreementTermsApiError && err.status === 409) {
        try {
          const latest = await getLatestAgreementTerm();
          setTerm(latest);
          setNotice("The agreement was updated. Please review the latest version.");
        } catch (latestError) {
          setError(
            latestError instanceof Error ? latestError.message : String(latestError),
          );
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCancel() {
    setPendingAction("cancel");
    setError(null);
    try {
      await logout();
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPendingAction(null);
    }
  }

  const busy = pendingAction !== null;

  return (
    <main className="min-h-screen bg-[#f8f8ff] px-4 py-8 sm:py-12">
      <section className="mx-auto w-full max-w-3xl rounded-xl border border-gray-300 bg-white p-5 shadow-sm sm:p-8">
        <header className="mb-6 border-b border-gray-200 pb-4">
          <div className="text-sm font-semibold tracking-wide text-blue-700">STGY</div>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">User Agreement</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            Please review the following terms before continuing.
          </p>
        </header>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center text-gray-500">
            Loading the agreement…
          </div>
        ) : term && content ? (
          <>
            {notice && (
              <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {notice}
              </div>
            )}
            <div
              className="max-h-[60vh] min-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-300 bg-gray-50 p-4 font-sans text-[15px] leading-7 text-gray-900 sm:p-6"
              lang={content.locale}
            >
              {content.text}
            </div>
          </>
        ) : (
          <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
            {error ?? "No agreement text is available for your locale or English."}
          </div>
        )}

        {!loading && error && term && content && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && (
          <>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="rounded border border-gray-300 bg-white px-5 py-2.5 font-semibold text-gray-800 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "cancel" ? "Logging out…" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleAgree}
                disabled={busy || !term || !content}
                className="rounded border border-blue-700 bg-blue-700 px-6 py-2.5 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "agree" ? "Processing…" : "Agree"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
