"use client";

import { useState } from "react";
import { renderHtml } from "@/utils/markdown";

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

![これはロゴです](/data/logo-square.svg)

\`\`\`sql
コードブロック
# これはヘッダじゃない
- これはリストじゃない
\`\`\`

We live in Tokyo.
`);
  const [maxLen, setMaxLen] = useState<number | undefined>(undefined);

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
      <div className="mb-4">
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
        <label className="block text-sm mb-1">Preview</label>
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: renderHtml(text, { maxLen: maxLen }) }}
          style={{ background: "#fff", border: "1px solid #888", padding: "1ex" }}
        />
      </div>
    </main>
  );
}
