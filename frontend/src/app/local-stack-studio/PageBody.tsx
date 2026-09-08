"use client";

import { useCallback, useEffect, useState } from "react";
import { checkLensfunRuntime } from "@/utils/lensfunCorrection";
import { checkLibRawRuntime } from "@/utils/libraw";
import { checkOpenCvRuntime } from "@/utils/opencv";

type HealthStatus = "checking" | "ok" | "error";

type HealthResult = {
  status: HealthStatus;
  detail: string;
};

type HealthKey = "libraw" | "lensfun" | "opencv";

type HealthResults = Record<HealthKey, HealthResult>;

const INITIAL_HEALTH: HealthResults = {
  libraw: { status: "checking", detail: "Loading…" },
  lensfun: { status: "checking", detail: "Loading…" },
  opencv: { status: "checking", detail: "Loading…" },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function HealthRow({ label, result }: { label: string; result: HealthResult }) {
  const statusLabel =
    result.status === "checking" ? "Checking" : result.status === "ok" ? "OK" : "Failed";
  const statusClass =
    result.status === "checking"
      ? "bg-amber-100 text-amber-800"
      : result.status === "ok"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-red-100 text-red-800";
  const dotClass =
    result.status === "checking"
      ? "bg-amber-500"
      : result.status === "ok"
        ? "bg-emerald-500"
        : "bg-red-500";

  return (
    <div className="flex flex-col gap-2 border-t border-gray-100 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="mt-0.5 break-all text-xs text-gray-500">{result.detail}</div>
      </div>
      <div
        className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}
      >
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
        {statusLabel}
      </div>
    </div>
  );
}

export default function LocalStackStudio() {
  const [health, setHealth] = useState<HealthResults>(INITIAL_HEALTH);

  const runHealthCheck = useCallback(async () => {
    setHealth(INITIAL_HEALTH);

    const checks: Array<[HealthKey, () => Promise<string>]> = [
      ["libraw", checkLibRawRuntime],
      ["lensfun", checkLensfunRuntime],
      ["opencv", checkOpenCvRuntime],
    ];

    await Promise.all(
      checks.map(async ([key, check]) => {
        try {
          const detail = await check();
          setHealth((current) => ({
            ...current,
            [key]: { status: "ok", detail },
          }));
        } catch (error) {
          setHealth((current) => ({
            ...current,
            [key]: { status: "error", detail: errorMessage(error) },
          }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    void runHealthCheck();
  }, [runHealthCheck]);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:py-8">
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gradient-to-br from-white via-gray-50 to-gray-100 px-5 py-6 sm:px-7 sm:py-8">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            Local Stack Studio
          </div>
          <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">
            Combine multiple images in your browser.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600 sm:text-base">
            Align and combine multiple images for denoising, HDR, focus stacking, and other
            workflows. Processing stays in your browser.
          </p>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Image runtime health</h2>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Verifies the browser runtimes served by STGY before the stacking UI is
                  integrated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runHealthCheck()}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Check again
              </button>
            </div>

            <div className="mt-3">
              <HealthRow label="LibRaw" result={health.libraw} />
              <HealthRow label="LensFun" result={health.lensfun} />
              <HealthRow label="OpenCV" result={health.opencv} />
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center sm:px-7 sm:py-12">
            <div className="text-sm font-semibold text-gray-900">Local Stack Studio</div>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-600">
              This is a placeholder page. The image stacking interface will be integrated here
              incrementally.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
