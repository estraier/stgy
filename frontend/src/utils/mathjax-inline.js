let mjLoadPromise = null;

function ensureMathJaxReady() {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window;
  if (w.MathJax && typeof w.MathJax.tex2svg === "function") {
    return (w.MathJax.startup && w.MathJax.startup.promise) || Promise.resolve();
  }
  if (!mjLoadPromise) {
    mjLoadPromise = import("../vendor/mathjax/tex-svg-full.js")
      .then(() => {
        const MJ = window.MathJax;
        return (MJ && MJ.startup && MJ.startup.promise) || Promise.resolve();
      })
      .catch(() => Promise.resolve());
  }
  return mjLoadPromise;
}

function patchDomInline(container, MJ) {
  const codes = container.querySelectorAll("code.math-inline:not([data-mj-processed])");
  codes.forEach((codeEl) => {
    const raw = codeEl.textContent || "";
    const tex = raw.replace(/^\s*\${1,2}([\s\S]*?)\${1,2}\s*$/u, "$1").trim();
    codeEl.setAttribute("data-mj-processed", "1");
    if (!tex) return;
    try {
      const holder = MJ.tex2svg(tex, { display: false });
      const svg = holder.querySelector("svg");
      if (!svg) return;
      const span = document.createElement("span");
      span.className = "math-inline";
      Array.from(codeEl.attributes).forEach((a) => {
        if (a.name !== "class") span.setAttribute(a.name, a.value);
      });
      span.appendChild(svg);
      codeEl.replaceWith(span);
    } catch {}
  });
}

function scheduleDomPatch() {
  if (typeof window === "undefined") return;
  ensureMathJaxReady().then(() => {
    const MJ = window.MathJax;
    if (!MJ || typeof MJ.tex2svg !== "function") return;
    requestAnimationFrame(() => {
      document.querySelectorAll(".markdown-body").forEach((el) => patchDomInline(el, MJ));
    });
  });
}

export function convertHtmlMathInline(html) {
  if (typeof window === "undefined") return html;
  const MJ = window.MathJax;

  if (MJ && typeof MJ.tex2svg === "function") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const nodes = doc.querySelectorAll("code.math-inline");
      nodes.forEach((codeEl) => {
        const raw = codeEl.textContent || "";
        const tex = raw.replace(/^\s*\${1,2}([\s\S]*?)\${1,2}\s*$/u, "$1").trim();
        if (!tex) return;
        const holder = MJ.tex2svg(tex, { display: false });
        const svg = holder.querySelector("svg");
        if (!svg) return;
        const span = doc.createElement("span");
        span.className = "math-inline";
        Array.from(codeEl.attributes).forEach((a) => {
          if (a.name !== "class") span.setAttribute(a.name, a.value);
        });
        span.appendChild(doc.importNode(svg, true));
        codeEl.replaceWith(span);
      });
      return doc.body.innerHTML;
    } catch {
      return html;
    }
  }

  scheduleDomPatch();
  return html;
}
