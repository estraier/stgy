const TRACK_JSON_EXTENSIONS = [".trj", ".json", ".geojson"];
const TRACK_JSON_GZIP_EXTENSIONS = [".trjgz"];
const JSON_MIME_TYPES = new Set([
  "application/json",
  "application/geo+json",
  "application/vnd.geo+json",
]);
const GZIP_MIME_TYPES = new Set([
  "application/gzip",
  "application/x-gzip",
]);

type TrackDataKind = "json" | "gzip";

/**
 * Track data loader for TrackJSON, compressed TrackJSON, data URLs, and DOM
 * template sources.
 */
export class TrackLoader {
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

    const jsonText = this.getElementText(element).trim();

    if (!jsonText) {
      throw new Error(`Track data is empty in element: ${selector}`);
    }

    return this.parseJsonText(jsonText, selector);
  }

  private getElementText(element: HTMLElement): string {
    if (element instanceof HTMLTemplateElement) {
      return element.content.textContent || "";
    }

    return element.textContent || "";
  }

  private async loadFromUrl(source: string): Promise<any> {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(`Failed to fetch track: ${response.statusText}`);
    }

    const kind = this.detectTrackDataKind(source, response);

    if (!kind) {
      throw new Error("Track data MIME type is not supported");
    }

    if (kind === "gzip") {
      return this.loadGzipResponse(response, source);
    }

    return this.parseJsonText(await response.text(), source);
  }

  private detectTrackDataKind(source: string, response: Response): TrackDataKind | null {
    if (this.hasExtension(source, TRACK_JSON_GZIP_EXTENSIONS)) {
      return "gzip";
    }

    if (this.hasExtension(source, TRACK_JSON_EXTENSIONS)) {
      return "json";
    }

    const mimeType = this.getMimeType(response);

    if (JSON_MIME_TYPES.has(mimeType)) {
      return "json";
    }

    if (GZIP_MIME_TYPES.has(mimeType)) {
      return "gzip";
    }

    return null;
  }

  private hasExtension(source: string, extensions: string[]): boolean {
    const path = source.split(/[?#]/, 1)[0].toLowerCase();
    return extensions.some((extension) => path.endsWith(extension));
  }

  private getMimeType(response: Response): string {
    const contentType = response.headers.get("content-type") || "";
    return contentType.split(";", 1)[0].trim().toLowerCase();
  }

  private isContentEncodedGzip(response: Response): boolean {
    const contentEncoding = response.headers.get("content-encoding") || "";
    return contentEncoding.toLowerCase().split(",").some((encoding) => {
      return encoding.trim() === "gzip";
    });
  }

  private async loadGzipResponse(response: Response, source: string): Promise<any> {
    if (this.isContentEncodedGzip(response)) {
      return this.parseJsonText(await response.text(), source);
    }

    if (typeof DecompressionStream === "undefined" || !response.body) {
      throw new Error("Gzip decompression is not supported in this browser");
    }

    const decompressedStream = response.body.pipeThrough(
      new DecompressionStream("gzip")
    );
    const decompressedResponse = new Response(decompressedStream);
    return this.parseJsonText(await decompressedResponse.text(), source);
  }

  private parseJsonText(text: string, source: string): any {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON in track data ${source}: ${(e as Error).message}`);
    }
  }
}
