import { resolve } from "path";

import { forEachLineSync } from "./lineReader";
import type { GeoAddress, GeoAliasRecord, GeoPlace, GeoPlaceRecord } from "./types";

const JAPANESE_LOCALE = "ja";
const MAX_DECODE_DISTANCE_KM = 10;
const EARTH_RADIUS_KM = 6371.0088;

type AliasIds = Uint16Array | Uint32Array;

interface ParsedPlace {
  readonly kind: "place";
  readonly value: GeoPlaceRecord;
}

interface ParsedAlias {
  readonly kind: "alias";
  readonly value: GeoAliasRecord;
}

type ParsedRecord = ParsedPlace | ParsedAlias;

export class GeoCoder {
  private readonly placesById = new Map<number, GeoPlaceRecord>();
  private readonly placesByCountryAndJapaneseLabel = new Map<string, GeoPlaceRecord>();
  private readonly highestLevelPlaces: readonly GeoPlaceRecord[];
  private readonly aliasLongitudes: Float32Array;
  private readonly aliasLatitudes: Float32Array;
  private readonly aliasBelongTo: AliasIds;
  private readonly highestLevel: number;

  constructor(initFiles: readonly string[]) {
    if (initFiles.length === 0) {
      throw new Error("GeoCoder requires at least one NDJSON file");
    }

    const files = initFiles.map((filePath) => resolve(filePath));
    let aliasCount = 0;
    let maximumId = 0;
    let highestLevel = 0;

    for (const filePath of files) {
      forEachLineSync(filePath, (line, lineNumber) => {
        const record = parseLine(filePath, line, lineNumber);
        if (record === undefined) {
          return;
        }
        if (record.kind === "alias") {
          aliasCount += 1;
          return;
        }

        const place = record.value;
        if (this.placesById.has(place.id)) {
          throw dataError(filePath, lineNumber, `duplicate place id: ${place.id}`);
        }
        const japaneseAddress = getJapaneseAddress(place);
        if (japaneseAddress === undefined) {
          throw dataError(filePath, lineNumber, "place has no Japanese address");
        }
        const labelKey = makeLabelKey(place.country, japaneseAddress.label);
        if (this.placesByCountryAndJapaneseLabel.has(labelKey)) {
          throw dataError(
            filePath,
            lineNumber,
            `duplicate Japanese label in ${place.country}: ${japaneseAddress.label}`,
          );
        }

        this.placesById.set(place.id, place);
        this.placesByCountryAndJapaneseLabel.set(labelKey, place);
        maximumId = Math.max(maximumId, place.id);
        highestLevel = Math.max(highestLevel, place.level);
      });
    }

    if (this.placesById.size === 0) {
      throw new Error("GeoCoder NDJSON files contain no place records");
    }

    this.highestLevel = highestLevel;
    this.highestLevelPlaces = Object.freeze(
      Array.from(this.placesById.values()).filter((place) => place.level === highestLevel),
    );
    this.aliasLongitudes = new Float32Array(aliasCount);
    this.aliasLatitudes = new Float32Array(aliasCount);
    this.aliasBelongTo = maximumId <= 0xffff ? new Uint16Array(aliasCount) : new Uint32Array(aliasCount);

    let aliasIndex = 0;
    for (const filePath of files) {
      forEachLineSync(filePath, (line, lineNumber) => {
        const record = parseLine(filePath, line, lineNumber);
        if (record === undefined || record.kind === "place") {
          return;
        }
        const place = this.placesById.get(record.value.belongTo);
        if (place === undefined) {
          throw dataError(
            filePath,
            lineNumber,
            `alias refers to unknown place id: ${record.value.belongTo}`,
          );
        }
        if (place.level !== this.highestLevel) {
          throw dataError(
            filePath,
            lineNumber,
            `alias must refer to level ${this.highestLevel}, got level ${place.level}`,
          );
        }
        this.aliasLongitudes[aliasIndex] = record.value.longitude;
        this.aliasLatitudes[aliasIndex] = record.value.latitude;
        this.aliasBelongTo[aliasIndex] = record.value.belongTo;
        aliasIndex += 1;
      });
    }
  }

  encode(query: string, _locale: string): GeoPlace[] {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return [];
    }

    const matched = findPlaceByJapaneseLabel(
      this.placesByCountryAndJapaneseLabel,
      normalizedQuery,
    );
    if (matched === undefined) {
      return [];
    }

    const address = getJapaneseAddress(matched);
    if (address === undefined) {
      return [];
    }

    const result: GeoPlace[] = [];
    let label = "";
    for (const element of address.elements) {
      label += element;
      const place = this.placesByCountryAndJapaneseLabel.get(makeLabelKey(matched.country, label));
      if (place !== undefined) {
        result.push(toPublicPlace(place));
      }
    }
    result.sort((left, right) => right.level - left.level);
    return result;
  }

  decode(longitude: number, latitude: number, locale: string): GeoPlace[] {
    if (!isLongitude(longitude) || !isLatitude(latitude)) {
      return [];
    }

    let bestPlaceId: number | undefined;
    let bestDistanceKm = Number.POSITIVE_INFINITY;

    for (const place of this.highestLevelPlaces) {
      const distanceKm = distanceKmBetween(
        longitude,
        latitude,
        place.longitude,
        place.latitude,
      );
      if (distanceKm < bestDistanceKm) {
        bestDistanceKm = distanceKm;
        bestPlaceId = place.id;
      }
    }

    for (let index = 0; index < this.aliasBelongTo.length; index += 1) {
      const distanceKm = distanceKmBetween(
        longitude,
        latitude,
        this.aliasLongitudes[index],
        this.aliasLatitudes[index],
      );
      if (distanceKm < bestDistanceKm) {
        bestDistanceKm = distanceKm;
        bestPlaceId = this.aliasBelongTo[index];
      }
    }

    if (bestPlaceId === undefined || bestDistanceKm > MAX_DECODE_DISTANCE_KM) {
      return [];
    }
    const place = this.placesById.get(bestPlaceId);
    const address = place === undefined ? undefined : getJapaneseAddress(place);
    if (address === undefined) {
      return [];
    }
    return this.encode(address.label, locale);
  }
}

function parseLine(filePath: string, line: string, lineNumber: number): ParsedRecord | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw dataError(filePath, lineNumber, `invalid JSON: ${message}`);
  }
  if (!isObject(value)) {
    throw dataError(filePath, lineNumber, "record must be an object");
  }

  const hasId = Object.prototype.hasOwnProperty.call(value, "id");
  const hasBelongTo = Object.prototype.hasOwnProperty.call(value, "belongTo");
  if (hasId === hasBelongTo) {
    throw dataError(filePath, lineNumber, "record must contain exactly one of id or belongTo");
  }

  return hasId
    ? { kind: "place", value: parsePlace(value, filePath, lineNumber) }
    : { kind: "alias", value: parseAlias(value, filePath, lineNumber) };
}

function parsePlace(
  value: Record<string, unknown>,
  filePath: string,
  lineNumber: number,
): GeoPlaceRecord {
  const id = requirePositiveInteger(value.id, filePath, lineNumber, "id");
  const level = requirePositiveInteger(value.level, filePath, lineNumber, "level");
  const country = requireNonEmptyString(value.country, filePath, lineNumber, "country");
  const longitude = requireLongitude(value.longitude, filePath, lineNumber);
  const latitude = requireLatitude(value.latitude, filePath, lineNumber);
  if (!Array.isArray(value.addresses) || value.addresses.length === 0) {
    throw dataError(filePath, lineNumber, "addresses must be a non-empty array");
  }

  const locales = new Set<string>();
  const addresses = value.addresses.map((rawAddress, index) => {
    if (!isObject(rawAddress)) {
      throw dataError(filePath, lineNumber, `addresses[${index}] must be an object`);
    }
    const locale = requireNonEmptyString(
      rawAddress.locale,
      filePath,
      lineNumber,
      `addresses[${index}].locale`,
    );
    if (locales.has(locale)) {
      throw dataError(filePath, lineNumber, `duplicate address locale: ${locale}`);
    }
    locales.add(locale);
    const label = requireNonEmptyString(
      rawAddress.label,
      filePath,
      lineNumber,
      `addresses[${index}].label`,
    );
    if (!Array.isArray(rawAddress.elements) || rawAddress.elements.length !== level) {
      throw dataError(
        filePath,
        lineNumber,
        `addresses[${index}].elements length must equal level ${level}`,
      );
    }
    const elements = rawAddress.elements.map((element, elementIndex) =>
      requireNonEmptyString(
        element,
        filePath,
        lineNumber,
        `addresses[${index}].elements[${elementIndex}]`,
      ),
    );
    if (elements.join("") !== label) {
      throw dataError(
        filePath,
        lineNumber,
        `addresses[${index}].label must equal concatenated elements`,
      );
    }
    return Object.freeze({ locale, label, elements: Object.freeze(elements) });
  });

  return Object.freeze({
    id,
    level,
    country,
    longitude,
    latitude,
    addresses: Object.freeze(addresses),
  });
}

function parseAlias(
  value: Record<string, unknown>,
  filePath: string,
  lineNumber: number,
): GeoAliasRecord {
  return {
    longitude: requireLongitude(value.longitude, filePath, lineNumber),
    latitude: requireLatitude(value.latitude, filePath, lineNumber),
    belongTo: requirePositiveInteger(value.belongTo, filePath, lineNumber, "belongTo"),
  };
}

function findPlaceByJapaneseLabel(
  places: ReadonlyMap<string, GeoPlaceRecord>,
  label: string,
): GeoPlaceRecord | undefined {
  let matched: GeoPlaceRecord | undefined;
  for (const place of places.values()) {
    const address = getJapaneseAddress(place);
    if (address?.label !== label) {
      continue;
    }
    if (matched !== undefined) {
      return undefined;
    }
    matched = place;
  }
  return matched;
}

function getJapaneseAddress(place: GeoPlaceRecord): GeoAddress | undefined {
  return place.addresses.find((address) => address.locale === JAPANESE_LOCALE);
}

function makeLabelKey(country: string, label: string): string {
  return `${country}\u0000${label}`;
}

function toPublicPlace(place: GeoPlaceRecord): GeoPlace {
  return Object.freeze({
    level: place.level,
    country: place.country,
    longitude: place.longitude,
    latitude: place.latitude,
    addresses: place.addresses,
  });
}

function distanceKmBetween(
  longitude1: number,
  latitude1: number,
  longitude2: number,
  latitude2: number,
): number {
  const latitude1Radians = degreesToRadians(latitude1);
  const latitude2Radians = degreesToRadians(latitude2);
  const latitudeDelta = latitude2Radians - latitude1Radians;
  const longitudeDelta = degreesToRadians(longitude2 - longitude1);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const haversine =
    sinLatitude * sinLatitude +
    Math.cos(latitude1Radians) * Math.cos(latitude2Radians) * sinLongitude * sinLongitude;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function requirePositiveInteger(
  value: unknown,
  filePath: string,
  lineNumber: number,
  field: string,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > 0xffffffff
  ) {
    throw dataError(
      filePath,
      lineNumber,
      `${field} must be an integer between 1 and 4294967295`,
    );
  }
  return value as number;
}

function requireNonEmptyString(
  value: unknown,
  filePath: string,
  lineNumber: number,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw dataError(filePath, lineNumber, `${field} must be a non-empty string`);
  }
  return value;
}

function requireLongitude(value: unknown, filePath: string, lineNumber: number): number {
  if (typeof value !== "number" || !isLongitude(value)) {
    throw dataError(filePath, lineNumber, "longitude must be between -180 and 180");
  }
  return value;
}

function requireLatitude(value: unknown, filePath: string, lineNumber: number): number {
  if (typeof value !== "number" || !isLatitude(value)) {
    throw dataError(filePath, lineNumber, "latitude must be between -90 and 90");
  }
  return value;
}

function isLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function isLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataError(filePath: string, lineNumber: number, message: string): Error {
  return new Error(`${filePath}:${lineNumber}: ${message}`);
}
