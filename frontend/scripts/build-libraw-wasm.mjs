import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIBRAW_WASM_VERSION = "1.6.0";
const LIBRAW_WASM_COMMIT = "32fd36a9883a10c1632bc20073f1ea88cc60487a";
const EMSCRIPTEN_VERSION = "5.0.7";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = dirname(scriptDir);
const buildScript = join(scriptDir, "build-libraw-wasm.sh");
const cacheDir = join(frontendDir, ".cache", `libraw-wasm-stgy-${LIBRAW_WASM_VERSION}`);
const distDir = join(cacheDir, "dist");
const force = process.argv.includes("--force");

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cacheIsValid() {
  if (force) return false;
  const required = ["index.js", "worker.js", "libraw.js", "libraw.wasm", "index.d.ts"];
  for (const name of required) {
    if (!(await fileExists(join(distDir, name)))) return false;
  }
  try {
    const stamp = JSON.parse(await readFile(join(cacheDir, "build.json"), "utf8"));
    return (
      stamp.librawWasmVersion === LIBRAW_WASM_VERSION &&
      stamp.librawWasmCommit === LIBRAW_WASM_COMMIT &&
      stamp.librawVersion === "0.22.1" &&
      stamp.emscriptenVersion === EMSCRIPTEN_VERSION &&
      stamp.pthread === false &&
      stamp.openmp === false
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

function hostToolchainIsUsable() {
  if (!["git", "python3", "emcc", "emconfigure", "emmake", "autoreconf"].every(hasCommand)) {
    return false;
  }
  if (!hasCommand("libtoolize") && !hasCommand("glibtoolize")) return false;
  return commandOutput("emcc", ["--version"]).split("\n")[0]?.includes(EMSCRIPTEN_VERSION) || false;
}

if (await cacheIsValid()) {
  process.exit(0);
}

if (hostToolchainIsUsable()) {
  execFileSync("bash", [buildScript, cacheDir], { cwd: frontendDir, stdio: "inherit" });
  process.exit(0);
}

if (!hasCommand("docker")) {
  throw new Error(
    `LibRaw-Wasm ${LIBRAW_WASM_VERSION} assets are missing. ` +
      `Install Emscripten ${EMSCRIPTEN_VERSION} with autotools, or make Docker available so STGY can build them automatically.`,
  );
}

try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
} catch {
  throw new Error(
    `LibRaw-Wasm ${LIBRAW_WASM_VERSION} assets are missing and Docker is not running. ` +
      `STGY needs Docker or a local Emscripten ${EMSCRIPTEN_VERSION} toolchain for the one-time non-pthread build.`,
  );
}

const uid = typeof process.getuid === "function" ? String(process.getuid()) : "0";
const gid = typeof process.getgid === "function" ? String(process.getgid()) : "0";
const containerFrontendDir = "/workspace/frontend";
const containerCacheDir = `${containerFrontendDir}/.cache/libraw-wasm-stgy-${LIBRAW_WASM_VERSION}`;
const containerBuildScript = `${containerFrontendDir}/scripts/build-libraw-wasm.sh`;

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
    `emscripten/emsdk:${EMSCRIPTEN_VERSION}`,
    "bash",
    "-lc",
    `apt-get update && ` +
      `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends autoconf automake libtool pkg-config git ca-certificates && ` +
      `rm -rf /var/lib/apt/lists/* && ` +
      `${containerBuildScript} ${containerCacheDir} && ` +
      `chown -R \"$HOST_UID:$HOST_GID\" ${containerCacheDir}`,
  ],
  { cwd: frontendDir, stdio: "inherit" },
);
