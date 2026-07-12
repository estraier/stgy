import type { TrackObject } from "@/api/models";
import { makeTrackMarkdown } from "@/utils/tracks";

export type ExistingMediaSelection =
  | {
      kind: "images";
      keys: string[];
    }
  | {
      kind: "tracks";
      tracks: Array<Pick<TrackObject, "previewKey">>;
    };

export function makeExistingMediaMarkdown(selection: ExistingMediaSelection): string {
  if (selection.kind === "images") {
    if (selection.keys.length === 0) return "";
    return selection.keys.map((key) => `![](/images/${key}){grid}`).join("\n") + "\n";
  }

  if (selection.tracks.length === 0) return "";
  return selection.tracks.map((track) => makeTrackMarkdown(track)).join("\n\n") + "\n";
}
