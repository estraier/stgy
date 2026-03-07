/**
 * Track Data Loader
 * Handles fetching from URL, Data URI, or DOM Element (Template).
 */
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

    // 圧縮ファイル（.trjgz）のハンドリング
    // 通常はサーバーが Content-Encoding: gzip を返せば fetch が自動解凍するが、
    // そうでない場合（octet-streamなど）のフォールバックとして DecompressionStream を使用。
    const isGzExtension = url.split('?')[0].endsWith(".trjgz");

    if (isGzExtension && typeof DecompressionStream !== "undefined") {
      try {
        const ds = new DecompressionStream("gzip");
        // bodyがnullでないことを確認してからパイプ
        if (response.body) {
          const decompressedStream = response.body.pipeThrough(ds);
          const decompressedResponse = new Response(decompressedStream);
          return await decompressedResponse.json();
        }
      } catch (e) {
        console.warn("[StgyTrack] Gzip decompression failed. Trying plain JSON parse...", e);
        // 解凍に失敗した場合はそのまま下に流してプレーンなJSONパースを試みる
      }
    }

    // .json, .trj, data:application/json または自動解凍済みのデータ
    return await response.json();
  }
}
