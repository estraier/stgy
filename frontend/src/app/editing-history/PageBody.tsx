"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { formatDateTime } from "@/utils/format";
import {
  cleanupEditingHistory,
  clearEditingHistory,
  listEditingHistorySnapshots,
  readEditingHistoryContent,
  type EditingHistorySnapshot,
} from "@/utils/editingHistory";

type SelectedHistory = {
  snapshot: EditingHistorySnapshot;
  content: string | null;
  loading: boolean;
  error: string | null;
};

function previewText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized || "(empty)";
}

export default function PageBody() {
  const status = useRequireLogin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedPage = useMemo(() => {
    const value = Number(searchParams.get("page"));
    return Number.isInteger(value) && value > 0 ? value : 1;
  }, [searchParams]);

  const [snapshots, setSnapshots] = useState<EditingHistorySnapshot[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedHistory | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const userId = status.state === "authenticated" ? status.session.userId : undefined;
  const timezone = status.state === "authenticated" ? status.session.userTimezone : undefined;

  const replacePage = useCallback(
    (page: number) => {
      const next = new URLSearchParams(searchParams);
      if (page <= 1) next.delete("page");
      else next.set("page", String(page));
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const loadSnapshots = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      await cleanupEditingHistory();
      const result = await listEditingHistorySnapshots(userId, requestedPage);
      setSnapshots(result.snapshots);
      setCurrentPage(result.page);
      setTotalPages(result.totalPages);
      setTotalCount(result.totalCount);
      if (result.page !== requestedPage) replacePage(result.page);
    } catch (caught: unknown) {
      setSnapshots([]);
      setCurrentPage(1);
      setTotalPages(0);
      setTotalCount(0);
      setError(caught instanceof Error ? caught.message : "Failed to load editing history.");
    } finally {
      setLoading(false);
    }
  }, [replacePage, requestedPage, userId]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  const openSnapshot = useCallback(
    async (snapshot: EditingHistorySnapshot) => {
      if (!userId) return;
      setSelected({ snapshot, content: null, loading: true, error: null });
      try {
        const result = await readEditingHistoryContent(snapshot.id, userId);
        setSelected({
          snapshot: result.snapshot,
          content: result.content,
          loading: false,
          error: null,
        });
      } catch (caught: unknown) {
        setSelected({
          snapshot,
          content: null,
          loading: false,
          error: caught instanceof Error ? caught.message : "Failed to read editing history.",
        });
      }
    },
    [userId],
  );

  const clearEntireHistory = useCallback(async () => {
    if (!userId || clearing) return;
    setClearing(true);
    setError(null);
    try {
      await clearEditingHistory(userId);
      setClearDialogOpen(false);
      await loadSnapshots();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Failed to clear editing history.");
    } finally {
      setClearing(false);
    }
  }, [clearing, loadSnapshots, userId]);

  if (status.state !== "authenticated") return null;

  return (
    <main className="max-w-4xl mx-auto mt-8 p-2 sm:p-4">
      <h1 className="text-2xl font-bold mb-3">Editing history</h1>
      <p className="mb-3 text-sm text-gray-600">
        Editing history is stored only in this browser. It is not synchronized with the server or
        other devices and may be removed by browser settings. Periodic snapshots are retained for
        3 days, successful saves for 10 days, and the last successful save for each post and day
        for 45 days. Older entries are removed first according to their retention progress when
        local storage reaches its limit.
      </p>
      <div className="mb-6 flex justify-end">
        <button
          type="button"
          className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
          onClick={() => setClearDialogOpen(true)}
        >
          Clear entire history
        </button>
      </div>

      {error && <div className="mb-4 text-red-600">{error}</div>}
      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : snapshots.length === 0 ? (
        <div className="text-gray-500">No editing history.</div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded bg-white">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2 border-b whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">Post / draft ID</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">Saved at</th>
                  <th className="px-3 py-2 border-b">Content</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr
                    key={snapshot.id}
                    className="hover:bg-blue-50 cursor-pointer"
                    onClick={() => void openSnapshot(snapshot)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openSnapshot(snapshot);
                      }
                    }}
                  >
                    <td className="px-3 py-2 border-b capitalize whitespace-nowrap">
                      {snapshot.targetType}
                    </td>
                    <td className="px-3 py-2 border-b font-mono whitespace-nowrap">
                      {snapshot.targetId}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      {formatDateTime(new Date(snapshot.timestamp), timezone, true)}
                    </td>
                    <td className="px-3 py-2 border-b min-w-[24rem]">
                      {previewText(snapshot.preview)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <div className="text-gray-600">
              {totalCount} {totalCount === 1 ? "entry" : "entries"}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={currentPage <= 1}
                className="px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => replacePage(currentPage - 1)}
              >
                Previous
              </button>
              <span className="whitespace-nowrap">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                className="px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => replacePage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-3"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Editing history detail"
        >
          <div className="bg-white rounded shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-start gap-3 px-4 py-3 border-b">
              <div className="min-w-0 flex-1">
                <div className="font-semibold break-all">
                  {selected.snapshot.targetType === "post" ? "Post" : "Draft"}: {" "}
                  {selected.snapshot.targetId}
                </div>
                <div className="text-sm text-gray-500">
                  {formatDateTime(new Date(selected.snapshot.timestamp), timezone, true)}
                </div>
              </div>
              <button
                type="button"
                className="px-3 py-1 rounded border bg-gray-100 hover:bg-gray-200"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>

            <div className="px-4 py-3 border-b flex items-center gap-3">
              <button
                type="button"
                disabled={selected.loading || selected.content === null || selected.error !== null}
                className="bg-blue-500 text-white hover:bg-blue-600 px-4 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  const restore = encodeURIComponent(selected.snapshot.id);
                  if (selected.snapshot.targetType === "post") {
                    router.push(
                      `/posts/${encodeURIComponent(selected.snapshot.targetId)}?mode=edit&restore=${restore}`,
                    );
                  } else {
                    router.push(`/posts?restore=${restore}`);
                  }
                }}
              >
                Continue editing
              </button>
              {selected.loading && <span className="text-sm text-gray-500">Loading…</span>}
              {selected.error && <span className="text-sm text-red-600">{selected.error}</span>}
            </div>

            <div className="p-4 overflow-auto min-h-0">
              {selected.content !== null && (
                <pre className="whitespace-pre-wrap break-words font-mono text-sm border rounded bg-gray-50 p-3 min-h-[16rem]">
                  {selected.content}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {clearDialogOpen && (
        <div
          className="fixed inset-0 z-[1100] bg-black/40 flex items-center justify-center p-3"
          onMouseDown={(event) => {
            if (!clearing && event.target === event.currentTarget) setClearDialogOpen(false);
          }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="clear-editing-history-title"
          aria-describedby="clear-editing-history-description"
        >
          <div className="bg-white rounded shadow-xl w-full max-w-md p-5">
            <h2 id="clear-editing-history-title" className="text-lg font-semibold mb-2">
              Clear entire history?
            </h2>
            <p id="clear-editing-history-description" className="text-sm text-gray-700 mb-5">
              This permanently deletes all editing history for your account stored in this
              browser. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={clearing}
                className="px-4 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setClearDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={clearing}
                className="px-4 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => void clearEntireHistory()}
              >
                {clearing ? "Clearing…" : "Clear entire history"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
