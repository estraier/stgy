import { resolve } from "path";

import { GeoCoder } from "./geocoder";

const DEFAULT_DATA_FILE = resolve(__dirname, "../data/geo-japan.ndjson");

function usage(command: "encode" | "decode"): string {
  if (command === "encode") {
    return 'usage: npm run encode "埼玉県所沢市" [locale]';
  }
  return "usage: npm run decode 135.1234, 35.1234 [locale]";
}

function getDataFiles(): string[] {
  const configured = process.env.STGY_GEO_STATIC_JSON_FILE?.trim();
  return [configured === undefined || configured.length === 0 ? DEFAULT_DATA_FILE : configured];
}

function parseCoordinate(value: string | undefined, name: string): number {
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number: ${value}`);
  }
  return parsed;
}

function parseDecodeArguments(args: readonly string[]): {
  readonly longitude: number;
  readonly latitude: number;
  readonly locale: string;
} {
  const coordinateText = args[1];
  if (coordinateText === undefined) {
    throw new Error(usage("decode"));
  }

  if (coordinateText.includes(",")) {
    const parts = coordinateText.split(",", 2);
    const longitude = parseCoordinate(parts[0], "longitude");
    const latitudeText = parts[1]?.trim();
    if (latitudeText !== undefined && latitudeText.length > 0) {
      return {
        longitude,
        latitude: parseCoordinate(latitudeText, "latitude"),
        locale: args[2] ?? "ja",
      };
    }
    return {
      longitude,
      latitude: parseCoordinate(args[2], "latitude"),
      locale: args[3] ?? "ja",
    };
  }

  return {
    longitude: parseCoordinate(coordinateText, "longitude"),
    latitude: parseCoordinate(args[2], "latitude"),
    locale: args[3] ?? "ja",
  };
}

function main(argv: readonly string[]): void {
  const command = argv[0];
  if (command !== "encode" && command !== "decode") {
    throw new Error("command must be encode or decode");
  }

  const geoCoder = new GeoCoder(getDataFiles());
  if (command === "encode") {
    const query = argv[1];
    if (query === undefined) {
      throw new Error(usage(command));
    }
    const locale = argv[2] ?? "ja";
    console.log(JSON.stringify(geoCoder.encode(query, locale), null, 2));
    return;
  }

  const { longitude, latitude, locale } = parseDecodeArguments(argv);
  console.log(JSON.stringify(geoCoder.decode(longitude, latitude, locale), null, 2));
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
}
