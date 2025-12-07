import fs from "fs";
import path from "path";

export type FileConfig = Record<string, unknown>;

function paramNotSetError(name: string): Error {
  return new Error(`config param "${name}" is not set`);
}

function paramTypeError(name: string, expected: string, actual: unknown): Error {
  const actualType = actual === null ? "null" : typeof actual;
  return new Error(
    `config param "${name}" must be ${expected}, but got ${actualType}`,
  );
}

export function loadConfig(configPath: string): FileConfig {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`config file not found: ${resolved}`);
  }

  const json = fs.readFileSync(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`invalid config JSON (${resolved}): ${String(e)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid config JSON (${resolved}): top-level must be an object`);
  }

  return parsed as FileConfig;
}

export function getFileConfigStr(config: FileConfig, name: string): string {
  const value = config[name];
  if (value === undefined) {
    throw paramNotSetError(name);
  }
  if (typeof value !== "string") {
    throw paramTypeError(name, "string", value);
  }
  return value;
}

export function getFileConfigNum(config: FileConfig, name: string): number {
  const value = config[name];
  if (value === undefined) {
    throw paramNotSetError(name);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw paramTypeError(name, "a finite number", value);
  }
  return value;
}

export function getFileConfigBool(config: FileConfig, name: string): boolean {
  const value = config[name];
  if (value === undefined) {
    throw paramNotSetError(name);
  }
  if (typeof value !== "boolean") {
    throw paramTypeError(name, "boolean", value);
  }
  return value;
}
