import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIBRAW_WASM_VERSION = "1.6.0";
const LIBRAW_WASM_COMMIT = "32fd36a9883a10c1632bc20073f1ea88cc60487a";
const SINGLE_EMSCRIPTEN_VERSION = "5.0.7";
const THREADED_EMSCRIPTEN_VERSION = "6.0.3";
const OPENMP_THREADS = 4;
const STGY_LIBRAW_THREADED_BUILD_REVISION = 3;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const buildScript = join(scriptDir, "build-libraw-wasm.sh");
const force = process.argv.includes("--force");

const variants = [
  {
    mode: "single",
    cacheDir: join(frontendDir, ".cache", `libraw-wasm-stgy-${LIBRAW_WASM_VERSION}`),
    emscriptenVersion: SINGLE_EMSCRIPTEN_VERSION,
    pthread: false,
    openmp: false,
    pthreadPool: null,
    openmpThreads: null,
    buildRevision: null,
  },
  {
    mode: "threaded",
    cacheDir: join(frontendDir, ".cache", `libraw-wasm-stgy-${LIBRAW_WASM_VERSION}-threaded`),
    emscriptenVersion: THREADED_EMSCRIPTEN_VERSION,
    pthread: true,
    openmp: true,
    pthreadPool: OPENMP_THREADS,
    openmpThreads: OPENMP_THREADS,
    buildRevision: STGY_LIBRAW_THREADED_BUILD_REVISION,
  },
];

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cacheIsValid(variant) {
  if (force) return false;
  const distDir = join(variant.cacheDir, "dist");
  const required = ["index.js", "worker.js", "libraw.js", "libraw.wasm", "index.d.ts"];
  for (const name of required) {
    if (!(await fileExists(join(distDir, name)))) return false;
  }
  try {
    const stamp = JSON.parse(await readFile(join(variant.cacheDir, "build.json"), "utf8"));
    return (
      stamp.librawWasmVersion === LIBRAW_WASM_VERSION &&
      stamp.librawWasmCommit === LIBRAW_WASM_COMMIT &&
      stamp.librawVersion === "0.22.1" &&
      stamp.emscriptenVersion === variant.emscriptenVersion &&
      (stamp.stgyBuildRevision ?? null) === variant.buildRevision &&
      stamp.mode === variant.mode &&
      stamp.pthread === variant.pthread &&
      stamp.openmp === variant.openmp &&
      (stamp.pthreadPool ?? null) === variant.pthreadPool &&
      (stamp.openmpThreads ?? null) === variant.openmpThreads
    );
  } catch {
    return false;
  }
}

function commandOutput(command, args = []) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function hasCommand(command) {
  return Boolean(commandOutput("sh", ["-c", `command -v ${command}`]).trim());
}

function hostToolchainIsUsable(emscriptenVersion) {
  if (!["git", "python3", "emcc", "em++", "emconfigure", "emmake", "autoreconf"].every(hasCommand)) {
    return false;
  }
  if (!hasCommand("libtoolize") && !hasCommand("glibtoolize")) return false;
  return commandOutput("emcc", ["--version"]).split("\n")[0]?.includes(emscriptenVersion) || false;
}

const missingVariants = [];
for (const variant of variants) {
  if (!(await cacheIsValid(variant))) missingVariants.push(variant);
}

if (missingVariants.length === 0) process.exit(0);

if (!hasCommand("docker") && !missingVariants.every((variant) => hostToolchainIsUsable(variant.emscriptenVersion))) {
  const versions = [...new Set(missingVariants.map((variant) => variant.emscriptenVersion))].join(" / ");
  throw new Error(
    `LibRaw-Wasm ${LIBRAW_WASM_VERSION} assets are missing. ` +
      `Install the required Emscripten toolchain(s) (${versions}) with autotools, or make Docker available so STGY can build them automatically.`,
  );
}

let dockerReady = false;
function ensureDockerReady() {
  if (dockerReady) return;
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    dockerReady = true;
  } catch {
    throw new Error(
      `LibRaw-Wasm ${LIBRAW_WASM_VERSION} assets are missing and Docker is not running. ` +
        `STGY needs Docker or the matching local Emscripten toolchain for the one-time LibRaw runtime builds.`,
    );
  }
}

const uid = typeof process.getuid === "function" ? String(process.getuid()) : "0";
const gid = typeof process.getgid === "function" ? String(process.getgid()) : "0";
const containerFrontendDir = "/workspace/frontend";
const containerBuildScript = `${containerFrontendDir}/scripts/build-libraw-wasm.sh`;

for (const variant of missingVariants) {
  if (hostToolchainIsUsable(variant.emscriptenVersion)) {
    execFileSync("bash", [buildScript, variant.cacheDir, variant.mode], {
      cwd: frontendDir,
      stdio: "inherit",
    });
    continue;
  }

  ensureDockerReady();
  const suffix = variant.mode === "threaded" ? "-threaded" : "";
  const containerCacheDir = `${containerFrontendDir}/.cache/libraw-wasm-stgy-${LIBRAW_WASM_VERSION}${suffix}`;
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--user",
      "root",
      "-e",
      `HOST_UID=${uid}`,
      "-e",
      `HOST_GID=${gid}`,
      "-v",
      `${frontendDir}:${containerFrontendDir}`,
      "-w",
      containerFrontendDir,
      `emscripten/emsdk:${variant.emscriptenVersion}`,
      "bash",
      "-lc",
      `apt-get update && ` +
        `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends autoconf automake libtool pkg-config git ca-certificates && ` +
        `rm -rf /var/lib/apt/lists/* && ` +
        `${containerBuildScript} ${containerCacheDir} ${variant.mode} && ` +
        `chown -R "$HOST_UID:$HOST_GID" ${containerCacheDir}`,
    ],
    { cwd: frontendDir, stdio: "inherit" },
  );
}
