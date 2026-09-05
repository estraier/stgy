import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const destinationDir = join(frontendDir, "public", "vendor", "lensfun-wasm");

let searchDir = frontendDir;
let packageDir = null;
while (true) {
  const candidate = join(
    searchDir,
    "node_modules",
    "@neoanaloglabkk",
    "lensfun-wasm",
  );
  try {
    const packageJson = JSON.parse(await readFile(join(candidate, "package.json"), "utf8"));
    if (packageJson?.name === "@neoanaloglabkk/lensfun-wasm") {
      packageDir = candidate;
      break;
    }
  } catch {}
  const parent = dirname(searchDir);
  if (parent === searchDir) break;
  searchDir = parent;
}
if (!packageDir) {
  throw new Error("Could not locate @neoanaloglabkk/lensfun-wasm under node_modules");
}

const sourceDir = join(packageDir, "dist");
await access(sourceDir);
await rm(destinationDir, { recursive: true, force: true });
await mkdir(destinationDir, { recursive: true });
await cp(sourceDir, destinationDir, { recursive: true });

for (const name of ["LICENSE", "LICENSE.md", "NOTICE.md", "THIRD_PARTY_LICENSES.md", "UPSTREAM.md"]) {
  const source = join(packageDir, name);
  try {
    await access(source);
    await cp(source, join(destinationDir, name));
  } catch {}
}

// lensfun-wasm 0.1.3's JS wrapper copies generated float maps through
// module.HEAPF32, but the bundled Emscripten core keeps HEAPF32 private.
// Export the view from updateMemoryViews() so the wrapper and core agree.
// Keeping this assignment inside updateMemoryViews() is important because a
// WebAssembly memory growth replaces the underlying ArrayBuffer and therefore
// requires a fresh Float32Array view.
const lensfunCoreJsPath = join(destinationDir, "assets", "lensfun-core.js");
let lensfunCoreJs = await readFile(lensfunCoreJsPath, "utf8");
const heapF32PrivateInit = "HEAPF32=new Float32Array(b)";
const heapF32ExportedInit = 'HEAPF32=Module["HEAPF32"]=new Float32Array(b)';
const heapF32InitCount = lensfunCoreJs.split(heapF32PrivateInit).length - 1;
if (heapF32InitCount !== 1) {
  throw new Error(
    `Unexpected LensFun core layout: found ${heapF32InitCount} HEAPF32 initializers, expected 1`,
  );
}
lensfunCoreJs = lensfunCoreJs.replace(heapF32PrivateInit, heapF32ExportedInit);
await writeFile(lensfunCoreJsPath, lensfunCoreJs, "utf8");

// lensfun-wasm 0.1.3 implements GMarkup with a vector-backed element-name
// stack. Lensfun itself keeps the element_name pointers passed to its callbacks,
// so vector growth can invalidate a parent name while parsing nested XML. That
// makes otherwise valid database files fail with errors such as
// "Inappropriate context for <mount>!".
//
// The bundled database never nests deeper than four elements. Replace each
// 53-byte DOCTYPE with a 53-byte, four-level empty <maker> warm-up tree. The
// compatibility parser accepts these empty elements without changing Lensfun
// objects, but its vector reaches size/capacity >= 4 before <lensdatabase> is
// entered. Keeping the replacement exactly the same byte length preserves every
// file offset embedded in lensfun-core.js.
const lensfunDataPath = join(destinationDir, "assets", "lensfun-core.data");
const lensfunData = await readFile(lensfunDataPath);
const lensfunDoctype = Buffer.from(
  '<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">',
  "utf8",
);
const lensfunParserWarmup = Buffer.from(
  "<maker><maker><maker><maker/></maker></maker></maker>",
  "utf8",
);
const expectedDatabaseFileCount = 56;

if (lensfunDoctype.length !== lensfunParserWarmup.length) {
  throw new Error("LensFun database parser warm-up must preserve byte length");
}

let patchedDatabaseFileCount = 0;
let offset = 0;
while ((offset = lensfunData.indexOf(lensfunDoctype, offset)) !== -1) {
  lensfunParserWarmup.copy(lensfunData, offset);
  offset += lensfunDoctype.length;
  patchedDatabaseFileCount += 1;
}

if (patchedDatabaseFileCount !== expectedDatabaseFileCount) {
  throw new Error(
    `Unexpected LensFun database layout: patched ${patchedDatabaseFileCount} XML files, expected ${expectedDatabaseFileCount}`,
  );
}

await writeFile(lensfunDataPath, lensfunData);
