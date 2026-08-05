const EXPORT_BASE_STYLES_CSS = `
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

:where(body.stgy-export) {
  margin: 0;
  background: #f8f8ff;
  color: #000;
  font-size: 16px;
  font-family: "IBM Plex Sans JP", "Noto Sans JP", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  word-break: normal;
  overflow-wrap: break-word;
}

:where(body.stgy-export) main {
  margin: 48px auto;
  padding: 16px;
}

:where(body.stgy-export) main { max-width: 780px; }

:where(body.stgy-export) .card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
}
:where(body.stgy-export) .post-meta {
  font-size: 90%;
  color: #888;
  margin-bottom: 0.3em;
}
:where(body.stgy-export) .post-attr {
  padding-right: 0.5em;
}
:where(body.stgy-export) .row {
  display: flex;
  gap: 16px;
  align-items: center;
}

:where(body.stgy-export) .row > div { min-width: 0; }

:where(body.stgy-export) .avatar {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid #e5e7eb;
  background: #f3f4f6;
  flex: 0 0 auto;
}

:where(body.stgy-export) h1 {
  font-size: 28px;
  margin: 0 0 8px;
  letter-spacing: 0.01em;
}

:where(body.stgy-export) .list-meta,
:where(body.stgy-export) .list-posts {
  padding-left: 0.8em;
}
:where(body.stgy-export) .snippet {
  display: block;
  white-space: nowrap;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
:where(body.stgy-export) .snippet h2 {
  font-size: 100%;
  display: inline;
}
:where(body.stgy-export) .snippet .author {
  color: #333333;
  font-size: 95%;
}

:where(body.stgy-export.stgy-export-post) h1 {
  font-size: 22px;
  margin: 0 0 6px;
}

:where(body.stgy-export) h2 {
  font-size: 15px;
  margin: 18px 0 8px;
  color: #374151;
}

:where(body.stgy-export) .muted {
  color: #6b7280;
  font-size: 13px;
  margin: 0 0 14px;
}

:where(body.stgy-export) table {
  width: 100%;
  border-collapse: collapse;
  margin: 4px 0 0;
}

:where(body.stgy-export) th,
:where(body.stgy-export) td {
  text-align: left;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: top;
}

:where(body.stgy-export) th {
  width: 180px;
  color: #6b7280;
  font-weight: 600;
}

:where(body.stgy-export) .reply-digests {
  font-size: 85%;
}

:where(body.stgy-export) .reply-digest + .reply-digest {
  margin-top: 1em;
}

:where(body.stgy-export) .reply-digest-meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 1.5em;
  color: #6b7280;
}

:where(body.stgy-export) .reply-digest-owner {
  color: #111827;
  font-weight: 600;
}

:where(body.stgy-export) .reply-digest-text {
  margin-top: 0.15em;
}

:where(body.stgy-export) code {
  font-family: "Inconsolata", "Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.95em;
}

/* tags (export post header) */
:where(body.stgy-export) .tags {
  margin: 10px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
:where(body.stgy-export) .tag {
  display: inline-block;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  padding: 2px 8px;
  font-size: 12px;
  color: #1d4ed8;
}
`;

const EXPORT_FINAL_STYLES_CSS = `
:where(body.stgy-export) .stgy-track-export-error {
  display: flex;
  min-height: 12rem;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  border: 1px solid #fca5a5;
  border-radius: 0.35em;
  background: #fef2f2;
  color: #b91c1c;
  text-align: center;
}
`;

export function buildHtmlStylesCss(articleContentCss: string): string {
  return `${EXPORT_BASE_STYLES_CSS}
${articleContentCss.trim()}
${EXPORT_FINAL_STYLES_CSS}`;
}
