// Check unresolved names in the legacy LSS controller while it still contains
// @ts-nocheck. This is intentionally scoped to missing names/exports; the
// remaining controller type migration can proceed separately.
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const frontendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = resolve(frontendDir, "tsconfig.json");
const controllerPath = resolve(frontendDir, "src/app/local-stack-studio/stack/controller.ts");
const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, " "));
const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, frontendDir);
if (config.errors.length > 0) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(config.errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => frontendDir,
    getNewLine: () => "\n",
  }));
}
const options = { ...config.options, noEmit: true, incremental: false, strict: false };
const host = ts.createCompilerHost(options);
const readFile = host.readFile.bind(host);
host.readFile = (path) => {
  const original = readFile(path);
  if (original === undefined || resolve(path) !== controllerPath) return original;
  return original.replace(/^\s*\/\/\s*@ts-nocheck\b.*$/m, "");
};
const program = ts.createProgram([controllerPath], options, host);
const source = program.getSourceFile(controllerPath);
if (!source) throw new Error("Cannot check the LSS controller source.");
// TS2304/TS2552/TS2663: missing variables. TS2305: missing named imports.
const unresolvedCodes = new Set([2304, 2552, 2663, 2305]);
const errors = program.getSemanticDiagnostics(source)
  .filter((diagnostic) => unresolvedCodes.has(diagnostic.code));
if (errors.length > 0) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => frontendDir,
    getNewLine: () => "\n",
  }));
  process.exitCode = 1;
}
