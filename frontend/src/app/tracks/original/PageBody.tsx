"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchTrackBinary } from "@/api/tracks";
import TrackPreviewMap from "@/components/TrackPreviewMap";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { prepareOriginalTrackViewBlob } from "@/utils/trackOriginal";
import { restPathFromTrackKey } from "@/utils/tracks";

export default function PageBody() {
  const status = useRequireLogin();
  const searchParams = useSearchParams();
  const trackKey = searchParams.get("key") || "";
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status.state !== "authenticated") return;

    if (!trackKey) {
      setError("Track key is missing.");
      return;
    }

    const userId = status.session.userId;
    const prefix = `${userId}/masters/`;
    if (!trackKey.startsWith(prefix)) {
      setError("The requested track is not available.");
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    setSourceUrl(null);

    void fetchTrackBinary(userId, restPathFromTrackKey(trackKey, userId))
      .then((blob) => prepareOriginalTrackViewBlob(trackKey, blob))
      .then((viewBlob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(viewBlob);
        setSourceUrl(objectUrl);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Failed to open original track.");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [status, trackKey]);

  if (status.state !== "authenticated") return null;

  return (
    <main className="track-original-viewer fixed inset-0 min-h-0 min-w-0 bg-white">
      {sourceUrl && <TrackPreviewMap src={sourceUrl} graph overlay controls />}
      {!sourceUrl && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          Loading…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-red-700 bg-red-50">
          {error}
        </div>
      )}
    </main>
  );
}
