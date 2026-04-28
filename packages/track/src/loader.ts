/**
 * Track Data Loader
 * Handles fetching from URL, Data URI, or DOM Element (Template).
 */
const JSON_MIME = "application/json";
const TRACK_JSON_MIME = "application/geo+json";
const GZIPPED_TRACK_JSON_MIME = "application/geo+json+gzip";

const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 80;

export class TrackLoader {
  /**
   * Load track data from a given source string (URL, Data URI, or DOM ID)
   */
  public async load(source: string): Promise<any> {
    if (source.startsWith("#")) {
      return Promise.resolve(this.loadFromDom(source));
    }
    return this.loadFromUrl(source);
  }

  private loadFromDom(selector: string): any {
    const id = selector.substring(1);
    const element = document.getElementById(id);

    if (!element) {
      throw new Error(`Track data element not found: ${selector}`);
    }

    let jsonString = "";
    if (element instanceof HTMLTemplateElement) {
      jsonString = element.content.textContent || "";
    } else {
      jsonString = element.textContent || "";
    }

    jsonString = jsonString.trim();

    if (!jsonString) {
      throw new Error(`Track data is empty in element: ${selector}`);
    }

    try {
      return JSON.parse(jsonString);
    } catch (e) {
      throw new Error(`Invalid JSON in element ${selector}: ${(e as Error).message}`);
    }
  }

  private async loadFromUrl(url: string): Promise<any> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch track: ${response.statusText}`);
    }

    const contentType = this.getContentType(response);

    if (
      contentType !== JSON_MIME &&
      contentType !== TRACK_JSON_MIME &&
      contentType !== GZIPPED_TRACK_JSON_MIME
    ) {
      throw new Error("Track data MIME type is not supported");
    }

    if (contentType === GZIPPED_TRACK_JSON_MIME) {
      const text = await this.readGzippedTrackJson(response);
      return JSON.parse(text);
    }

    return await response.json();
  }

  private getContentType(response: Response): string {
    return (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() || ""
    );
  }

  private async readGzippedTrackJson(response: Response): Promise<string> {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Gzip compressed TrackJSON is not supported in this environment");
    }

    const blob = await response.blob();

    if (blob.size > MAX_COMPRESSED_BYTES) {
      throw new Error("Compressed TrackJSON is too large");
    }

    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();

    let total = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;

      if (total > MAX_UNCOMPRESSED_BYTES) {
        await reader.cancel("uncompressed size limit exceeded");
        throw new Error("Uncompressed TrackJSON is too large");
      }

      if (blob.size > 0 && total > blob.size * MAX_COMPRESSION_RATIO) {
        await reader.cancel("compression ratio limit exceeded");
        throw new Error("Suspicious TrackJSON compression ratio");
      }

      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(merged);
  }
}
