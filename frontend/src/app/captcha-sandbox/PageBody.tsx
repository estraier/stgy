"use client";

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  createCaptchaChallenge,
  getCaptchaStatus,
  resetCaptchaPass,
  verifyCaptchaChallenge,
  type CaptchaChallenge,
  type CaptchaStatus,
} from "@/api/captcha";

const EMPTY_STATUS: CaptchaStatus = { valid: false, used: 0, remaining: 0 };

export default function CaptchaSandbox() {
  const [status, setStatus] = useState<CaptchaStatus | null>(null);
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChallenge = useCallback(async () => {
    const next = await createCaptchaChallenge();
    setChallenge(next);
    setAnswer("");
  }, []);

  const initialize = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const nextStatus = await getCaptchaStatus();
      setStatus(nextStatus);
      if (!nextStatus.valid) {
        await loadChallenge();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadChallenge]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const refreshChallenge = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await loadChallenge();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challenge || answer.length !== 6) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await verifyCaptchaChallenge(challenge.challengeId, answer);
      const nextStatus: CaptchaStatus = {
        valid: result.passed,
        used: 0,
        remaining: result.remaining,
      };
      setStatus(nextStatus);
      setChallenge(null);
      setAnswer("");
      setMessage("CAPTCHA passed. The pass token was stored in an HttpOnly cookie.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await resetCaptchaPass();
      setStatus(EMPTY_STATUS);
      await loadChallenge();
      setMessage("Pass token cleared.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">CAPTCHA Sandbox</h1>

      <section className="mb-6 rounded border border-gray-300 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Pass token</h2>
        {status === null ? (
          <p>Checking…</p>
        ) : status.valid ? (
          <p>
            Valid. Used {status.used}, remaining {status.remaining}.
          </p>
        ) : (
          <p>Not available.</p>
        )}
        {status?.valid && (
          <button
            type="button"
            className="mt-3 rounded border border-gray-400 px-3 py-1 disabled:opacity-50"
            disabled={busy}
            onClick={() => void reset()}
          >
            Reset pass token
          </button>
        )}
      </section>

      {!status?.valid && (
        <section className="rounded border border-gray-300 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Challenge</h2>
          {challenge ? (
            <form onSubmit={(event) => void verify(event)}>
              <div className="mb-4 flex items-center gap-3">
                {/* The backend returns a raster PNG, never the source glyph data. */}
                <Image
                  src={challenge.image}
                  width={200}
                  height={48}
                  alt="Six digit CAPTCHA"
                  className="border border-gray-400 bg-white"
                  unoptimized
                />
                <button
                  type="button"
                  className="rounded border border-gray-400 px-3 py-1 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void refreshChallenge()}
                >
                  New image
                </button>
              </div>

              <label className="block">
                <span className="mr-2">Enter the six digits:</span>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-36 rounded border border-gray-400 px-2 py-1 font-mono text-lg tracking-widest"
                  disabled={busy}
                />
              </label>

              <button
                type="submit"
                className="mt-4 rounded border border-gray-500 px-4 py-1.5 disabled:opacity-50"
                disabled={busy || answer.length !== 6}
              >
                Verify
              </button>
            </form>
          ) : (
            <p>{busy ? "Generating…" : "No challenge."}</p>
          )}
        </section>
      )}

      {message && <p className="mt-4 text-sm">{message}</p>}
      {error && <p className="mt-4 text-sm text-red-700">Error: {error}</p>}
    </main>
  );
}
