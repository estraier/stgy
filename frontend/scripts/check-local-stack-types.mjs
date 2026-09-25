import { spawnSync } from "node:child_process";

const strictFiles = [
  "src/app/local-stack-studio/stack/focus-math.ts",
  "src/app/local-stack-studio/workers/opencv-runtime.ts",
  "src/app/local-stack-studio/workers/alignment-preprocess.ts",
  "src/app/local-stack-studio/workers/transfer-buffer.ts",
  "src/app/local-stack-studio/workers/protocols/alignment-protocol.ts",
  "src/app/local-stack-studio/workers/protocols/focus-protocol.ts",
  "src/app/local-stack-studio/workers/protocols/hdr-protocol.ts",
  "src/app/local-stack-studio/workers/orb.worker.ts",
  "src/app/local-stack-studio/workers/ecc.worker.ts",
  "src/app/local-stack-studio/workers/focus.worker.ts",
  "src/app/local-stack-studio/stack/worker-clients.ts",
];

const syntaxFiles = [
  ...strictFiles,
  "src/app/local-stack-studio/stack/controller.ts",
  "src/app/local-stack-studio/workers/hdr.worker.ts",
];

function runTsc(args, label) {
  const result = spawnSync("tsc", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

const common = [
  "--noEmit",
  "--pretty", "false",
  "--skipLibCheck",
  "--target", "es2022",
  "--module", "esnext",
  "--lib", "es2022,dom",
];

runTsc([
  ...common,
  "--strict",
  "--noUnusedLocals",
  "--noUnusedParameters",
  "--moduleResolution", "bundler",
  ...strictFiles,
], "LSS strict worker type check");

runTsc([
  ...common,
  "--noResolve",
  ...syntaxFiles,
], "LSS controller/HDR syntax check");
