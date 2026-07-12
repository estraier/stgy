import { getTrackFileKind } from "./tracks";

export async function prepareOriginalTrackViewBlob(filename: string, source: Blob): Promise<Blob> {
  const kind = getTrackFileKind(filename);

  if (kind === "TRJGZ") {
    return new Blob([await source.arrayBuffer()], { type: "application/gzip" });
  }

  if (kind === "FIT") {
    const fit = await import("stgy-track/fit");
    const activity = fit.parseFitBytes(await source.arrayBuffer());
    const json = fit.trackActivityToTrackJson(activity, { pretty: false });
    return new Blob([json], { type: "application/json" });
  }

  throw new Error("Only stored FIT and TRJGZ tracks can be opened.");
}
