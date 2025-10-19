// utils/mathjax-inline.ts

let mjLoadPromise: Promise<void> | null = null;

type MathJaxAPI = {
  tex2svg: (tex: string, opts?: { display?: boolean }) => HTMLElement;
  tex2mml?: (tex: string, opts?: { display?: boolean }) => string;
  startup?: { promise?: Promise<void> };
};

declare global {
  interface Window {
    MathJax?: MathJaxAPI;
  }
}

export function ensureMathJaxReady(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const MJ = window.MathJax;
  if (MJ && typeof MJ.tex2svg === "function") {
    return MJ.startup?.promise ?? Promise.resolve();
  }
  if (!mjLoadPromise) {
    mjLoadPromise = import("../vendor/mathjax/tex-svg-full.js")
      .then(() => window.MathJax?.startup?.promise ?? Promise.resolve())
      .catch(() => Promise.resolve());
  }
  return mjLoadPromise;
}

function patchDomInline(container: Element, MJ: MathJaxAPI): void {
  const codes = container.querySelectorAll<HTMLElement>(
    "code.math-inline:not([data-mj-processed])",
  );
  codes.forEach((codeEl) => {
    const raw = codeEl.textContent || "";
    const tex = raw.replace(/^\s*\${1,2}([\s\S]*?)\${1,2}\s*$/u, "$1").trim();
    codeEl.setAttribute("data-mj-processed", "1");
    if (!tex) return;

    try {
      const holder = MJ.tex2svg(tex, { display: false });
      const svg = holder.querySelector("svg") as SVGSVGElement | null;
      if (!svg) return;

      const span = document.createElement("span");
      span.className = "math-inline";
      span.setAttribute("aria-hidden", "true");
      span.setAttribute("data-tex", tex);
      Array.from(codeEl.attributes).forEach((a: Attr) => {
        if (a.name !== "class") span.setAttribute(a.name, a.value);
      });
      span.appendChild(svg);

      const sr = document.createElement("span");
      sr.className = "math-inline-mml-sr";
      sr.setAttribute("role", "math");
      sr.style.position = "absolute";
      sr.style.width = "1px";
      sr.style.height = "1px";
      sr.style.padding = "0";
      sr.style.margin = "-1px";
      sr.style.overflow = "hidden";
      // @ts-expect-error legacy clip syntax for maximum compatibility
      sr.style.clip = "rect(0, 0, 0, 0)";
      sr.style.whiteSpace = "nowrap";
      sr.style.border = "0";

      try {
        const mml = MJ.tex2mml ? MJ.tex2mml(tex, { display: false }) : "";
        if (mml) sr.innerHTML = mml;
        else sr.textContent = tex;
      } catch {
        sr.textContent = tex;
      }

      codeEl.replaceWith(span);
      span.insertAdjacentElement("afterend", sr);
    } catch {
      /* noop */
    }
  });
}

function scheduleDomPatch(): void {
  if (typeof window === "undefined") return;
  ensureMathJaxReady().then(() => {
    const MJ = window.MathJax;
    if (!MJ || typeof MJ.tex2svg !== "function") return;
    requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>(".markdown-body")
        .forEach((el) => patchDomInline(el, MJ));
    });
  });
}

export function convertHtmlMathInline(html: string): string {
  if (typeof window === "undefined") return html;
  const MJ = window.MathJax;

  if (MJ && typeof MJ.tex2svg === "function") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const nodes = doc.querySelectorAll<HTMLElement>("code.math-inline");
      nodes.forEach((codeEl) => {
        const raw = codeEl.textContent || "";
        const tex = raw.replace(/^\s*\${1,2}([\s\S]*?)\${1,2}\s*$/u, "$1").trim();
        if (!tex) return;

        const holder = MJ.tex2svg(tex, { display: false });
        const svg = holder.querySelector("svg") as SVGSVGElement | null;
        if (!svg) return;

        const span = doc.createElement("span");
        span.className = "math-inline";
        span.setAttribute("aria-hidden", "true");
        span.setAttribute("data-tex", tex);
        Array.from(codeEl.attributes).forEach((a: Attr) => {
          if (a.name !== "class") span.setAttribute(a.name, a.value);
        });
        span.appendChild(doc.importNode(svg, true));

        const sr = doc.createElement("span");
        sr.className = "math-inline-mml-sr";
        sr.setAttribute("role", "math");
        sr.setAttribute(
          "style",
          [
            "position:absolute",
            "width:1px",
            "height:1px",
            "padding:0",
            "margin:-1px",
            "overflow:hidden",
            "clip:rect(0, 0, 0, 0)",
            "white-space:nowrap",
            "border:0",
          ].join(";"),
        );

        try {
          const mml = MJ.tex2mml ? MJ.tex2mml(tex, { display: false }) : "";
          if (mml) sr.innerHTML = mml;
          else sr.textContent = tex;
        } catch {
          sr.textContent = tex;
        }

        codeEl.replaceWith(span);
        span.insertAdjacentElement("afterend", sr);
      });
      return doc.body.innerHTML;
    } catch {
      return html;
    }
  }

  scheduleDomPatch();
  return html;
}

export function patchMathInlineInContainer(container: Element): void {
  if (typeof window === "undefined") return;
  ensureMathJaxReady().then(() => {
    const MJ = window.MathJax;
    if (!MJ || typeof MJ.tex2svg !== "function") return;
    patchDomInline(container, MJ);
  });
}
