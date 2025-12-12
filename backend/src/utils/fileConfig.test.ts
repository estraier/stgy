import fs from "fs";
import os from "os";
import path from "path";
import {
  loadConfig,
  getFileConfigStr,
  getFileConfigNum,
  getFileConfigBool,
  type FileConfig,
} from "./fileConfig";

describe("fileConfig", () => {
  describe("loadConfig", () => {
    test("loads a valid JSON object config", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fileConfigTest-"));
      const filePath = path.join(dir, "config.json");
      const data = { foo: "bar", num: 42, flag: true };

      fs.writeFileSync(filePath, JSON.stringify(data), "utf8");

      const cfg = loadConfig(filePath);
      expect(cfg).toEqual(data);
    });

    test("throws if file does not exist", () => {
      const filePath = path.join(os.tmpdir(), `fileConfigTest-missing-${Date.now()}.json`);
      expect(() => loadConfig(filePath)).toThrow(/config file not found/);
    });

    test("throws if JSON is invalid", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fileConfigTest-"));
      const filePath = path.join(dir, "invalid.json");

      fs.writeFileSync(filePath, "{ invalid json", "utf8");

      expect(() => loadConfig(filePath)).toThrow(/invalid config JSON/);
    });

    test("throws if top-level JSON is not an object", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fileConfigTest-"));
      const filePath = path.join(dir, "not-object.json");

      fs.writeFileSync(filePath, JSON.stringify(123), "utf8");

      expect(() => loadConfig(filePath)).toThrow(/top-level must be an object/);
    });
  });

  describe("getFileConfigStr", () => {
    const cfg: FileConfig = {
      s: "hello",
      n: 1,
      b: true,
    };

    test("returns string value when present and string", () => {
      expect(getFileConfigStr(cfg, "s")).toBe("hello");
    });

    test("throws if param is not set", () => {
      expect(() => getFileConfigStr(cfg, "missing")).toThrow(/config param "missing" is not set/);
    });

    test("throws if param is not a string", () => {
      expect(() => getFileConfigStr(cfg, "n")).toThrow(/config param "n" must be string/);
      expect(() => getFileConfigStr(cfg, "b")).toThrow(/config param "b" must be string/);
    });
  });

  describe("getFileConfigNum", () => {
    const cfg: FileConfig = {
      n: 123,
      s: "not-number",
      inf: Infinity,
    };

    test("returns number value when present and finite", () => {
      expect(getFileConfigNum(cfg, "n")).toBe(123);
    });

    test("throws if param is not set", () => {
      expect(() => getFileConfigNum(cfg, "missing")).toThrow(/config param "missing" is not set/);
    });

    test("throws if param is not a number", () => {
      expect(() => getFileConfigNum(cfg, "s")).toThrow(/config param "s" must be a finite number/);
    });

    test("throws if param is not finite", () => {
      expect(() => getFileConfigNum(cfg, "inf")).toThrow(
        /config param "inf" must be a finite number/,
      );
    });
  });

  describe("getFileConfigBool", () => {
    const cfg: FileConfig = {
      b: true,
      s: "yes",
      n: 0,
    };

    test("returns boolean value when present and boolean", () => {
      expect(getFileConfigBool(cfg, "b")).toBe(true);
    });

    test("throws if param is not set", () => {
      expect(() => getFileConfigBool(cfg, "missing")).toThrow(/config param "missing" is not set/);
    });

    test("throws if param is not a boolean", () => {
      expect(() => getFileConfigBool(cfg, "s")).toThrow(/config param "s" must be boolean/);
      expect(() => getFileConfigBool(cfg, "n")).toThrow(/config param "n" must be boolean/);
    });
  });
});
