/// <reference lib="webworker" />

import { makeArticlePreviewFragmentsFromMarkdown } from "@/utils/article";
import type { MdHtmlFragment } from "stgy-markdown";

type PostPreviewWorkerRequest = {
  type: "render-preview";
  generation: number;
  content: string;
};

type PostPreviewWorkerResponse =
  | {
      type: "render-preview-complete";
      generation: number;
      contentLength: number;
      fragments: MdHtmlFragment[];
    }
  | {
      type: "render-preview-error";
      generation: number;
      message: string;
    };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<PostPreviewWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== "render-preview") return;

  try {
    const fragments = makeArticlePreviewFragmentsFromMarkdown(request.content);
    const response: PostPreviewWorkerResponse = {
      type: "render-preview-complete",
      generation: request.generation,
      contentLength: request.content.length,
      fragments,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: PostPreviewWorkerResponse = {
      type: "render-preview-error",
      generation: request.generation,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
});
