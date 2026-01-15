export const HTML_STYLES_CSS = `
/* =========================
 * Export base
 * ========================= */
:root { color-scheme: light; }

*,
*::before,
*::after { box-sizing: border-box; }

html {
  margin: 0;
  background: #f8f8ff;
}

body.stgy-export {
  margin: 0;
  background: #f8f8ff;
  color: #000;
  font-size: 16px;
  font-family: "IBM Plex Sans JP", "Noto Sans JP", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  word-break: normal;
  overflow-wrap: break-word;
}

body.stgy-export main {
  margin: 48px auto;
  padding: 16px;
}

body.stgy-export.stgy-export-profile main { max-width: 780px; }
body.stgy-export.stgy-export-post main { max-width: 780px; }

body.stgy-export .card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
}

body.stgy-export .row {
  display: flex;
  gap: 16px;
  align-items: center;
}

body.stgy-export .row > div { min-width: 0; }

body.stgy-export .avatar {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid #e5e7eb;
  background: #f3f4f6;
  flex: 0 0 auto;
}

body.stgy-export h1 {
  font-size: 28px;
  margin: 0 0 8px;
  letter-spacing: 0.01em;
}

body.stgy-export.stgy-export-post h1 {
  font-size: 22px;
  margin: 0 0 6px;
}

body.stgy-export h2 {
  font-size: 15px;
  margin: 18px 0 8px;
  color: #374151;
}

body.stgy-export .muted {
  color: #6b7280;
  font-size: 13px;
  margin: 0 0 14px;
}

body.stgy-export table {
  width: 100%;
  border-collapse: collapse;
  margin: 4px 0 0;
}

body.stgy-export th,
body.stgy-export td {
  text-align: left;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: top;
}

body.stgy-export th {
  width: 180px;
  color: #6b7280;
  font-weight: 600;
}

body.stgy-export code {
  font-family: "Inconsolata", "Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.95em;
}

/* tags (export post header) */
body.stgy-export .tags {
  margin: 10px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
body.stgy-export .tag {
  display: inline-block;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  padding: 2px 8px;
  font-size: 12px;
  color: #1d4ed8;
}

/* =========================
 * Markdown styles (ported from globals.css)
 * Scope: body.stgy-export
 * ========================= */
body.stgy-export .markdown-body {
  position: relative;
  line-height: 1.6;
  word-break: normal;
  overflow-wrap: break-word;
  overflow-x: hidden;
}
body.stgy-export .markdown-body::after {
  content: "";
  display: table;
  clear: both;
}

body.stgy-export .markdown-body h1 {
  margin: 0.5em 0 0.46em 0;
  font-size: 130%;
  font-weight: bold;
  color: #025;
  border-bottom: 1px solid #abc;
}
body.stgy-export .markdown-body.user-introduction h1 {
  font-size: 120%;
}
body.stgy-export .markdown-body h2 {
  margin: 0.525em 0 0.475em 0;
  font-size: 115%;
  font-weight: bold;
}
body.stgy-export .markdown-body.user-introduction h2 {
  font-size: 110%;
}
body.stgy-export .markdown-body h3 {
  margin: 0.55em 0;
  font-size: 105%;
  font-weight: bold;
}
body.stgy-export .markdown-body h4 {
  margin: 0.55em 0;
  font-size: 100%;
  font-weight: bold;
  opacity: 0.9;
}
body.stgy-export .markdown-body h5 {
  margin: 0.55em 0;
  font-size: 90%;
  font-weight: bold;
  opacity: 0.8;
}
body.stgy-export .markdown-body h6 {
  margin: 0.55em 0;
  font-size: 85%;
  font-weight: bold;
  opacity: 0.7;
}
body.stgy-export .markdown-body h1:first-child,
body.stgy-export .markdown-body h2:first-child,
body.stgy-export .markdown-body h3:first-child,
body.stgy-export .markdown-body h4:first-child,
body.stgy-export .markdown-body h5:first-child,
body.stgy-export .markdown-body h6:first-child {
  margin-top: 0.3em;
}

body.stgy-export .markdown-body p {
  margin: 0.55em 0;
}

body.stgy-export .markdown-body blockquote {
  margin: 0.55em 0 0.5em 0.4em;
  padding-left: 0.4em;
  line-height: 1.5;
  font-size: 95%;
  border-left: 3px solid #ddd;
}

body.stgy-export .markdown-body ul {
  margin: 0.55em 0;
  line-height: 1.4;
  list-style-type: disc;
  padding-left: 1.4em;
}
body.stgy-export .markdown-body ul[data-bullet="number"] {
  list-style-type: decimal;
}
body.stgy-export .markdown-body ul[data-bullet="none"] {
  line-height: inherit;
  list-style: none;
}
body.stgy-export .markdown-body ul:has(li[data-meta]) {
  text-align: right;
  margin-right: 0.5em;
  list-style: none;
  opacity: 0.9;
}
body.stgy-export .markdown-body li[data-meta]::before {
  content: attr(data-meta) ": ";
  font-size: 80%;
  opacity: 0.5;
}
body.stgy-export .markdown-body ul ul {
  margin: 0;
}
body.stgy-export .markdown-body li {
  margin: 0;
  padding: 0;
}

body.stgy-export .markdown-body pre {
  position: relative;
  margin: 0.55em 0.25em;
  padding: 0.1em 0.25em;
  line-height: 1.4;
  background: #f7f7fa;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: 0.25em;
  font-family: "Inconsolata", "Source Code Pro", monospace;
  font-size: 95%;
  border: 1px solid #eee;
}
body.stgy-export .markdown-body pre[data-pre-mode]::before {
  position: absolute;
  content: attr(data-pre-mode);
  top: 0.35em;
  right: 0.4em;
  font-size: 80%;
  opacity: 0.3;
  pointer-events: none;
  user-select: none;
}
body.stgy-export .markdown-body pre[data-pre-style="xsmall"],
body.stgy-export .markdown-body pre[data-pre-style^="xsmall:"],
body.stgy-export .markdown-body pre[data-pre-style$=":xsmall"],
body.stgy-export .markdown-body pre[data-pre-style*=":xsmall:"] {
  font-size: 75%;
}
body.stgy-export .markdown-body pre[data-pre-style="small"],
body.stgy-export .markdown-body pre[data-pre-style^="small:"],
body.stgy-export .markdown-body pre[data-pre-style$=":small"],
body.stgy-export .markdown-body pre[data-pre-style*=":small:"] {
  font-size: 85%;
}
body.stgy-export .markdown-body pre[data-pre-style="large"],
body.stgy-export .markdown-body pre[data-pre-style^="large:"],
body.stgy-export .markdown-body pre[data-pre-style$=":large"],
body.stgy-export .markdown-body pre[data-pre-style*=":large:"] {
  font-size: 105%;
}
body.stgy-export .markdown-body pre[data-pre-style="xlarge"],
body.stgy-export .markdown-body pre[data-pre-style^="xlarge:"],
body.stgy-export .markdown-body pre[data-pre-style$=":xlarge"],
body.stgy-export .markdown-body pre[data-pre-style*=":xlarge:"] {
  font-size: 115%;
}
body.stgy-export .markdown-body pre[data-pre-style="bold"],
body.stgy-export .markdown-body pre[data-pre-style^="bold:"],
body.stgy-export .markdown-body pre[data-pre-style$=":bold"],
body.stgy-export .markdown-body pre[data-pre-style*=":bold:"] {
  font-weight: bold;
}
body.stgy-export .markdown-body pre[data-pre-style="italic"],
body.stgy-export .markdown-body pre[data-pre-style^="italic:"],
body.stgy-export .markdown-body pre[data-pre-style$=":italic"],
body.stgy-export .markdown-body pre[data-pre-style*=":italic:"] {
  font-style: italic;
}
body.stgy-export .markdown-body pre[data-pre-mode="natural"] {
  line-height: 1.5;
  background: none;
  font-family: "IBM Plex Sans JP", "Noto Sans JP", sans-serif;
  font-size: 100%;
  border: none;
  border-left: 3px solid #eee;
  border-radius: 0;
}
body.stgy-export .markdown-body pre[data-pre-mode="natural"]::before {
  display: none;
  content: "";
}

body.stgy-export .markdown-body table {
  margin: 0.55em 0.25em;
  border-collapse: collapse;
}
body.stgy-export .markdown-body th,
body.stgy-export .markdown-body td {
  padding: 0.1em 0.25em;
  line-height: 1.2;
  font-size: 95%;
  font-weight: normal;
  border: solid 1px #888;
  text-align: left;
  vertical-align: top;
  word-break: break-all;
}
body.stgy-export .markdown-body th {
  font-size: 95%;
  background: #eee;
}
body.stgy-export .markdown-body table .align-center {
  text-align: center;
}
body.stgy-export .markdown-body table .align-right {
  text-align: right;
}

body.stgy-export .markdown-body .image-block {
  position: relative;
  margin: 0.55em 0.25em;
  width: 20em;
  max-height: 20em;
  cursor: zoom-in;
  display: flex;
  align-items: center;
  justify-content: center;
}
body.stgy-export .markdown-body .image-block.expanded {
  width: 98%;
  max-height: 40em;
  clear: both;
  cursor: zoom-out;
  display: block;
}
body.stgy-export .markdown-body .featured-block {
  float: right;
  width: min(11em, 40%);
  max-height: 12em;
  margin: 0.25em 0 0.25em 0.25em;
  display: flex;
  align-items: center;
  justify-content: center;
}
body.stgy-export .markdown-body .image-block figcaption {
  position: absolute;
  bottom: 0.25em;
  right: 0.25em;
  padding: 0.05em 0.25em;
  background: #fff;
  color: #000;
  border: 1px solid #ddd;
  border-radius: 0.25em;
  opacity: 0.7;
  font-size: 65%;
}
body.stgy-export .markdown-body .image-block:hover figcaption {
  opacity: 0.1;
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-float="left"] {
  float: left;
  margin: 0.15em 0.6em 0.15em 0;
  width: min(17.5em, 50%);
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-float="right"] {
  float: right;
  margin: 0.15em 0 0.15em 0.6em;
  width: min(17.5em, 50%);
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-size="xsmall"] {
  width: min(13em, 32%);
  max-height: 13em;
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-size="small"] {
  width: min(16em, 40%);
  max-height: 16em;
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-size="medium"] {
  width: min(20em, 50%);
  max-height: 20em;
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-size="large"] {
  width: min(27.5em, 60%);
  max-height: 27.5em;
}
body.stgy-export .markdown-body:not(.excerpt) figure.image-block:not(.expanded)[data-size="xlarge"] {
  width: min(35em, 70%);
  max-height: 35em;
}

body.stgy-export .markdown-body:not(.excerpt) .image-grid {
  display: grid;
  gap: 0.5em;
  margin: 0.5em 0 1em;
  clear: both;
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid figure.image-block {
  width: 100%;
  max-width: 100%;
  max-height: none;
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid figure.image-block[data-size] {
  width: unset;
  max-height: unset;
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="1"] {
  grid-template-columns: minmax(0, 1fr);
  width: 60%;
  margin-left: auto;
  margin-right: auto;
}
body.stgy-export .markdown-body:not(.excerpt)
  .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="xsmall"]) {
  width: 35%;
}
body.stgy-export .markdown-body:not(.excerpt)
  .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="small"]) {
  width: 46%;
}
body.stgy-export .markdown-body:not(.excerpt)
  .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="large"]) {
  width: 73%;
}
body.stgy-export .markdown-body:not(.excerpt)
  .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="xlarge"]) {
  width: 95%;
}
@media (max-width: 640px) {
  body.stgy-export .markdown-body:not(.excerpt)
    .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="xsmall"]) {
    width: 46%;
  }
  body.stgy-export .markdown-body:not(.excerpt)
    .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="small"]) {
    width: 60%;
  }
  body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="1"] {
    width: 80%;
  }
  body.stgy-export .markdown-body:not(.excerpt)
    .image-grid[data-cols="1"]:has(figure.image-block:not(.expanded)[data-size="large"]) {
    width: 90%;
  }
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="2"] {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="3"] {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="4"] {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="5"] {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid figure.image-block {
  float: none;
  margin: 0;
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid figure.image-block.expanded {
  grid-column: 1 / -1;
}
body.stgy-export .markdown-body:not(.excerpt) .image-grid[data-cols="1"]:has(figure.image-block.expanded) {
  width: 100%;
}

body.stgy-export .markdown-body .image-block img,
body.stgy-export .markdown-body .image-block video {
  display: block;
  max-width: 100%;
  max-height: inherit;
  width: auto;
  height: auto;
  border: 1px solid #ddd;
  border-radius: 0.35em;
}
body.stgy-export .markdown-body .featured-block img,
body.stgy-export .markdown-body .featured-block video {
  display: block;
  max-width: 100%;
  max-height: inherit;
  width: auto;
  height: auto;
  border: 1px solid #ddd;
  border-radius: 0.25em;
}
body.stgy-export .markdown-body .featured-block figcaption {
  display: none;
}

body.stgy-export .markdown-body a {
  color: #03c;
  text-decoration: none;
}
body.stgy-export .markdown-body a:hover {
  text-decoration: underline;
}
body.stgy-export .markdown-body code {
  padding: 0 0.1em;
  word-break: break-all;
  font-family: "Inconsolata", "Source Code Pro", monospace;
  background: #eee;
}
body.stgy-export .markdown-body pre code {
  padding: unset;
  font-size: unset;
  background: unset;
  line-height: 1.3;
  white-space: inherit;
  word-break: inherit;
  overflow-wrap: inherit;
}
body.stgy-export .markdown-body mark {
  background: #fde;
}
body.stgy-export .markdown-body small {
  font-size: 70%;
  opacity: 0.9;
}
body.stgy-export .markdown-body rt {
  margin-top: -0.8em;
  margin-bottom: -0.8em;
  opacity: 0.9;
}
body.stgy-export .markdown-body .math-inline svg {
  display: inline-block;
}
body.stgy-export .markdown-body hr {
  clear: both;
  border: 0;
  margin: 0 2.5em;
}
body.stgy-export .markdown-body hr[data-hr-level="2"] {
  border-top: 1px solid #aaa;
  margin: 0.75em 2.5em;
}
body.stgy-export .markdown-body hr[data-hr-level="3"] {
  border-top: 1px solid #666;
  margin: 1em 0.5em;
}

body.stgy-export .markdown-body .omitted {
  margin: 0 0.1em;
}

body.stgy-export .markdown-body .toc {
  position: relative;
  margin: 0.55em 0.2em 0.55em 0.2em;
  padding-left: 0.4em;
  line-height: 1.5;
  font-size: 95%;
  border: 1px solid #ddd;
  border-radius: 0.25em;
}
body.stgy-export .markdown-body .toc::before {
  position: absolute;
  top: 0.1em;
  right: 0.4em;
  font-size: 85%;
  color: #012;
  content: "table of contents";
  opacity: 0.3;
}
body.stgy-export .markdown-body .toc a {
  color: #026;
}
body.stgy-export .markdown-body .toc a:hover {
  color: #03c;
}

body.stgy-export .markdown-body code[class*="language-"] *,
body.stgy-export .markdown-body pre[class*="language-"] * {
  background: none;
}
body.stgy-export .markdown-body code[class*="language-"],
body.stgy-export .markdown-body pre[class*="language-"] {
  text-shadow: none !important;
}

/* =========================
 * Prism theme (optional)
 * =========================
 * globals.css は @import "prismjs/themes/prism.css"; なので、
 * エクスポートHTMLも同じ色にしたい場合は、node_modules の prism.css の中身を
 * ここに貼り付けてください（ZIP内自己完結のため）。
 */
/* PRISM_THEME_PLACEHOLDER */
`;
