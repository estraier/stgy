"use client";

import { useState } from "react";
import {
  parseMarkdown,
  mdGroupImageGrid,
  mdFilterForFeatured,
  mdCutOff,
  mdRenderHtml,
  mdRenderText,
} from "stgy-markdown";

export default function PageBody() {
  const [text, setText] = useState(`# ヘッダ

## サブヘッダ

### サブサブヘッダ

地の文。地の文。
地の文の中の改行は<br>扱いで、マージンなしで改行。

段落は空白で区切る。一つの段落は<p>で囲む。

> ブロッククォートも*ある*。
> こんな__感じ__で**ね**。

- リスト1
  - サブリストA
    - サブ**サブ**
- リスト2
- リスト3

Go to [Google](https://google.com/).
Set: http://example.com/

### Go to [Google](https://google.com/) and **Yahoo**
### Set: http://example.com/ and __Yapoo__

- Go to [Google](https://google.com/) and **Yahoo**
  - Set: http://example.com/ and __Yapoo__

- We __live__ *in* **Tokyo** [Shinjuku](https://ja.wikipedia.org/wiki/%E6%96%B0%E5%AE%BF)

|We|__live__|in|**Tokyo**|[Shinjuku](https://ja.wikipedia.org/wiki/%E6%96%B0%E5%AE%BF)|
|one|**two**|three|four|five|

![これはロゴです](/data/logo-square.svg){size=small}

\`\`\`sql
コードブロック
# これはヘッダじゃない
- これはリストじゃない
\`\`\`

We live in Tokyo.

![ロゴ1](/data/logo-square.svg){grid}
![ロゴ2](/data/logo-square.svg){grid,featured}
![ロゴ3](/data/logo-square.svg){grid}
`);
  const [mode, setMode] = useState<"html" | "text">("html");
  const [maxLen, setMaxLen] = useState<number | undefined>(undefined);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const [useFeatured, setUseFeatured] = useState<boolean>(false);

  return (
    <main className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Markdown Renderer Test</h1>

      <div className="mb-4">
        <label className="block text-sm mb-1">Markdown Input</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          className="w-full border px-3 py-2 rounded font-mono text-sm"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm mb-1">Preview</label>
          <select
            className="border px-2 py-1 rounded w-40"
            value={mode}
            onChange={(e) => setMode(e.target.value as "html" | "text")}
          >
            <option value="html">HTML</option>
            <option value="text">Text</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">maxLen (optional)</label>
          <input
            type="number"
            min={1}
            placeholder="unlimited"
            className="border px-2 py-1 rounded w-32"
            value={maxLen ?? ""}
            onChange={(e) => {
              const val = Number(e.target.value);
              setMaxLen(e.target.value ? Math.max(1, val) : undefined);
            }}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">maxHeight (optional)</label>
          <input
            type="number"
            min={1}
            placeholder="unlimited"
            className="border px-2 py-1 rounded w-32"
            value={maxHeight ?? ""}
            onChange={(e) => {
              const val = Number(e.target.value);
              setMaxHeight(e.target.value ? Math.max(1, val) : undefined);
            }}
          />
        </div>

        <label className="inline-flex items-center gap-2 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={useFeatured}
            onChange={(e) => setUseFeatured(e.target.checked)}
            disabled={mode !== "html"}
          />
          <span className="text-sm">useFeatured</span>
        </label>
      </div>

      {mode === "html" ? (
        <div className="mb-6">
          <label className="block text-sm mb-1">Preview HTML</label>
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: makeHtml(text, maxLen, maxHeight, useFeatured) }}
            style={{
              background: "#fff",
              border: "1px solid #888",
              padding: "1ex",
              height: "40ex",
              overflow: "auto",
            }}
          />
        </div>
      ) : (
        <div className="mb-6">
          <label className="block text-sm mb-1">Preview Text</label>
          <pre
            className="w-full border px-3 py-2 rounded whitespace-pre-wrap break-words text-sm"
            style={{ background: "#fff", height: "40ex", overflow: "auto" }}
          >
            {makeText(text, maxLen, maxHeight)}
          </pre>
        </div>
      )}
    </main>
  );
}

function makeHtml(mdText: string, maxLen?: number, maxHeight?: number, useFeatured?: boolean) {
  let nodes = parseMarkdown(mdText);
  nodes = mdGroupImageGrid(nodes);
  if (useFeatured) {
    nodes = mdFilterForFeatured(nodes);
  }
  nodes = mdCutOff(nodes, { maxLen, maxHeight });
  return mdRenderHtml(nodes);
}

function makeText(mdText: string, maxLen?: number, maxHeight?: number) {
  let nodes = parseMarkdown(mdText);
  nodes = mdCutOff(nodes, { maxLen, maxHeight, imgLen: -1, imgHeight: 1 });
  return mdRenderText(nodes);
}
