"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  formatStackBytes,
  formatStackBytesExact,
  formatStackDimensions,
  formatStackDuration,
  formatStackInfoText,
  type LocalStackStudioInfoReport,
} from "./stack/info-report";

type Props = { report: LocalStackStudioInfoReport; onClose: () => void };

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-1 text-sm">
    <dt className="text-gray-500">{label}</dt>
    <dd className="min-w-0 break-words text-right font-medium text-gray-900">{value}</dd>
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-gray-200 p-4">
    <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
    {children}
  </section>;
}

export default function InfoDialog({ report, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const root = closeRef.current?.closest('[role="dialog"]');
        const buttons = root?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons || buttons.length === 0) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatStackInfoText(report));
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="stack-info-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
        <h2 id="stack-info-title" className="text-lg font-semibold text-gray-950">Image information</h2>
        <button ref={closeRef} onClick={onClose} aria-label="Close image information" className="rounded-md px-3 py-1.5 text-xl text-gray-500 hover:bg-gray-100">×</button>
      </div>
      <div className="space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">Input</div><div className="text-xl font-semibold">{report.inputs.length} {report.inputs.length === 1 ? "image" : "images"}</div></div>
          <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">Total processing time</div><div className="text-xl font-semibold tabular-nums">{formatStackDuration(report.totalMs)}</div></div>
        </div>
        <Section title="Input images">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-gray-200 text-gray-500"><tr><th className="py-2 pr-3 font-medium">File</th><th className="pr-3 font-medium">Size</th><th className="pr-3 font-medium">Format</th><th className="pr-3 font-medium">Dimensions</th><th className="font-medium">Bits/channel</th></tr></thead>
              <tbody>{report.inputs.map((input, index) => <tr key={`${index}:${input.fileName}`} className="border-b border-gray-100 last:border-0">
                <td className="max-w-48 break-all py-2 pr-3 font-medium">{input.fileName}<div className="mt-0.5 font-normal text-gray-500">{[input.fNumber == null ? null : `f/${input.fNumber}`, input.exposureTime == null ? null : `${input.exposureTime} s`, input.iso == null ? null : `ISO ${input.iso}`].filter(Boolean).join(" · ")}</div></td>
                <td className="whitespace-nowrap pr-3">{formatStackBytesExact(input.bytes)}</td><td className="pr-3">{input.format}</td><td className="whitespace-nowrap pr-3">{formatStackDimensions(input.width, input.height)}</td><td>{input.bitsPerChannel ?? "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Output image">
          <dl className="divide-y divide-gray-100">
            <InfoRow label="Result dimensions" value={formatStackDimensions(report.resultWidth, report.resultHeight)}/>
            <InfoRow label="Selected export" value={`${report.outputFormat} · ${report.outputBitsPerChannel} bits/channel`}/>
            <InfoRow label="Export dimensions" value={formatStackDimensions(report.outputWidth, report.outputHeight)}/>
            <InfoRow label="Exported file size" value={report.encodedBytes === null ? "Not encoded yet" : formatStackBytesExact(report.encodedBytes)}/>
            <InfoRow label="Result RGB buffer (uncompressed)" value={formatStackBytesExact(report.resultWidth * report.resultHeight * 3 * 2)}/>
            <InfoRow label="Output color profile" value={report.outputColorSpace}/>
          </dl>
          {report.encodedBytes === null && <p className="mt-2 text-xs text-gray-500">The compressed file size is available after downloading this format and size.</p>}
        </Section>
        <Section title="Processing settings">
          <dl className="divide-y divide-gray-100">
            <InfoRow label="Merge" value={report.mergeMode}/>
            <InfoRow label="Alignment selection" value={report.alignmentMode}/>
            <InfoRow label="Actual alignment" value={report.actualAlignmentMode}/>
            <InfoRow label="Reference image" value={report.referenceFileName ?? "Not applicable"}/>
            {report.settings.map((s, i) => <InfoRow key={`${i}:${s.label}`} label={s.label} value={s.value}/>)}
          </dl>
        </Section>
        <Section title="Processing time">
          <dl className="divide-y divide-gray-100">
            {report.timings.map((t, i) => <InfoRow key={`${i}:${t.label}`} label={t.label} value={`${formatStackDuration(t.durationMs)}${t.includedIn ? ` (part of ${t.includedIn})` : ""}`}/>)}
            <InfoRow label="Total wall time" value={formatStackDuration(report.totalMs)}/>
          </dl>
        </Section>
        <Section title="Memory and storage">
          <dl className="divide-y divide-gray-100">
            <InfoRow label="Retained output image buffers" value={formatStackBytes(report.retainedOutputBufferBytes)}/>
            <InfoRow label="Alignment frame cache" value={formatStackBytes(report.alignmentFrameCacheBytes)}/>
            <InfoRow label="Canonical chunk memory cache" value={formatStackBytes(report.canonicalChunkCacheBytes)}/>
            <InfoRow label="Canonical cache payload (disk)" value={formatStackBytes(report.canonicalCachePayloadBytes)}/>
            <InfoRow label="Page JavaScript heap (sample)" value={formatStackBytes(report.pageJsHeapBytes)}/>
          </dl>
        </Section>
        {report.warnings.length > 0 && <Section title="Notes"><ul className="list-inside list-disc text-sm text-gray-600">{report.warnings.map((item, i) => <li key={i}>{item}</li>)}</ul></Section>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-5 py-3">
        {copyError && <span className="self-center text-xs text-red-700">Copy failed. Check clipboard permission.</span>}
        <button type="button" onClick={() => void copy()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">{copied ? "Copied" : "Copy information"}</button>
        <button type="button" onClick={onClose} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">Close</button>
      </div>
    </div>
  </div>;
}
