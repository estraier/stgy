import { resolve } from "path";

import { Config } from "./config";
import { forEachLineSync } from "./lineReader";
import type {
  GeoAddressRecord,
  GeoAliasRecord,
  GeoPlace,
  GeoPlaceKind,
  GeoPlaceRecord,
} from "./types";

const JAPANESE_LOCALE = "ja";
const MAX_DECODE_DISTANCE_KM = 10;
const EARTH_RADIUS_KM = 6371.0088;
const MAX_DECODE_LATITUDE_DELTA_DEGREES =
  (MAX_DECODE_DISTANCE_KM / EARTH_RADIUS_KM) * (180 / Math.PI);

type AliasIds = Uint16Array | Uint32Array;

interface ParsedPlace {
  readonly kind: "place";
  readonly value: GeoPlaceRecord;
}

interface ParsedAlias {
  readonly kind: "alias";
  readonly value: GeoAliasRecord;
}

interface LoadedAlias {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly value: GeoAliasRecord;
}

type ParsedRecord = ParsedPlace | ParsedAlias;

interface LocaleSearchSpace {
  readonly labels: Map<string, GeoPlaceRecord[]>;
  readonly aliases: Map<string, GeoPlaceRecord[]>;
}

export class GeoCoder {
  private readonly placesById = new Map<number, GeoPlaceRecord>();
  private readonly countriesByCode = new Map<string, GeoPlaceRecord>();
  private readonly placesByCountryAndJapaneseLabel = new Map<string, GeoPlaceRecord>();
  private readonly searchSpacesByLocale = new Map<string, LocaleSearchSpace>();
  private readonly supportedLocales = new Set<string>();
  private readonly defaultLocale: string;
  private readonly decodePlaces: readonly GeoPlaceRecord[];
  private readonly aliasLongitudes: Float32Array;
  private readonly aliasLatitudes: Float32Array;
  private readonly aliasBelongTo: AliasIds;

  constructor(initFiles: readonly string[]) {
    if (initFiles.length === 0) {
      throw new Error("GeoCoder requires at least one NDJSON file");
    }

    const files = initFiles.map((filePath) => resolve(filePath));
    const aliases: LoadedAlias[] = [];
    let maximumId = 0;

    for (const filePath of files) {
      forEachLineSync(filePath, (line, lineNumber) => {
        const record = parseLine(filePath, line, lineNumber);
        if (record === undefined) {
          return;
        }
        if (record.kind === "alias") {
          aliases.push({ filePath, lineNumber, value: record.value });
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

        if (place.kind === "country") {
          const existingCountry = this.countriesByCode.get(place.country);
          if (existingCountry !== undefined) {
            throw dataError(
              filePath,
              lineNumber,
              `duplicate country record: ${place.country}`,
            );
          }
          this.countriesByCode.set(place.country, place);
        }

        this.placesById.set(place.id, place);
        this.placesByCountryAndJapaneseLabel.set(labelKey, place);
        for (const address of place.addresses) {
          this.supportedLocales.add(address.locale);
          const searchSpace = getOrCreateSearchSpace(
            this.searchSpacesByLocale,
            address.locale,
          );
          for (const searchLabel of makeAddressSearchLabels(address)) {
            addPlaceToSearchIndex(searchSpace.labels, searchLabel, place);
          }
          for (const alias of address.aliases) {
            addPlaceToSearchIndex(searchSpace.aliases, alias, place);
          }
        }
        maximumId = Math.max(maximumId, place.id);
      });
    }

    if (this.placesById.size === 0) {
      throw new Error("GeoCoder NDJSON files contain no place records");
    }
    for (const place of this.placesById.values()) {
      if (place.kind !== "country" && !this.countriesByCode.has(place.country)) {
        throw new Error(`place ${place.id} has no country record: ${place.country}`);
      }
    }

    this.defaultLocale =
      resolveSupportedLocale(this.supportedLocales, Config.DEFAULT_LOCALE) ??
      normalizeLocale(Config.DEFAULT_LOCALE) ??
      Config.DEFAULT_LOCALE;

    for (const alias of aliases) {
      if (!this.placesById.has(alias.value.belongTo)) {
        throw dataError(
          alias.filePath,
          alias.lineNumber,
          `alias refers to unknown place id: ${alias.value.belongTo}`,
        );
      }
    }

    const decodePlaceIds = collectDecodePlaceIds(
      this.placesById,
      this.placesByCountryAndJapaneseLabel,
    );
    this.decodePlaces = Object.freeze(
      Array.from(decodePlaceIds, (placeId) => this.placesById.get(placeId))
        .filter((place): place is GeoPlaceRecord => place !== undefined)
        .sort(comparePlacesByLatitude),
    );
    const aliasLongitudes = new Float32Array(aliases.length);
    const aliasLatitudes = new Float32Array(aliases.length);
    const aliasBelongTo: AliasIds =
      maximumId <= 0xffff
        ? new Uint16Array(aliases.length)
        : new Uint32Array(aliases.length);

    for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
      const alias = aliases[aliasIndex];
      if (!decodePlaceIds.has(alias.value.belongTo)) {
        throw dataError(
          alias.filePath,
          alias.lineNumber,
          `alias must refer to a reverse-geocoding place: ${alias.value.belongTo}`,
        );
      }
      aliasLongitudes[aliasIndex] = alias.value.longitude;
      aliasLatitudes[aliasIndex] = alias.value.latitude;
      aliasBelongTo[aliasIndex] = alias.value.belongTo;
    }

    const sortedAliases = sortAliasesByLatitude(
      aliasLongitudes,
      aliasLatitudes,
      aliasBelongTo,
    );
    this.aliasLongitudes = sortedAliases.longitudes;
    this.aliasLatitudes = sortedAliases.latitudes;
    this.aliasBelongTo = sortedAliases.belongTo;
  }

  encode(query: string, locale?: string): GeoPlace[] {
    const normalizedQuery = normalizeSearchKey(query);
    if (normalizedQuery.length === 0) {
      return [];
    }

    const resolvedLocale = this.resolveLocale(locale);
    const matchedById = new Map<number, GeoPlaceRecord>();
    for (const searchLocale of getSearchLocales(resolvedLocale, this.defaultLocale)) {
      const searchSpace = this.searchSpacesByLocale.get(searchLocale);
      if (searchSpace === undefined) {
        continue;
      }
      const exactMatches = searchSpace.labels.get(normalizedQuery) ?? [];
      const matches =
        exactMatches.length > 0
          ? exactMatches
          : searchSpace.aliases.get(normalizedQuery) ?? [];
      for (const place of matches) {
        matchedById.set(place.id, place);
      }
    }
    if (matchedById.size === 0) {
      return [];
    }

    return collectPlaceHierarchy(
      matchedById.values(),
      this.countriesByCode,
      this.placesByCountryAndJapaneseLabel,
    )
      .sort(comparePlacesForEncode)
      .map((place) => toPublicPlace(place, resolvedLocale, this.defaultLocale));
  }

  decode(longitude: number, latitude: number, locale?: string): GeoPlace[] {
    if (!isLongitude(longitude) || !isLatitude(latitude)) {
      return [];
    }

    let bestPlaceId: number | undefined;
    let bestDistanceKm = Number.POSITIVE_INFINITY;
    const minimumLatitude = latitude - MAX_DECODE_LATITUDE_DELTA_DEGREES;
    const maximumLatitude = latitude + MAX_DECODE_LATITUDE_DELTA_DEGREES;

    const placeStartIndex = lowerBoundPlacesByLatitude(
      this.decodePlaces,
      minimumLatitude,
    );
    const placeEndIndex = upperBoundPlacesByLatitude(
      this.decodePlaces,
      maximumLatitude,
    );
    for (let index = placeStartIndex; index < placeEndIndex; index += 1) {
      const place = this.decodePlaces[index];
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

    const aliasStartIndex = lowerBoundLatitudes(this.aliasLatitudes, minimumLatitude);
    const aliasEndIndex = upperBoundLatitudes(this.aliasLatitudes, maximumLatitude);
    for (let index = aliasStartIndex; index < aliasEndIndex; index += 1) {
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
    if (place === undefined) {
      return [];
    }
    const resolvedLocale = this.resolveLocale(locale);
    return collectPlaceHierarchy(
      [place],
      this.countriesByCode,
      this.placesByCountryAndJapaneseLabel,
    )
      .sort(comparePlacesForEncode)
      .map((hierarchyPlace) =>
        toPublicPlace(hierarchyPlace, resolvedLocale, this.defaultLocale),
      );
  }

  private resolveLocale(locale?: string): string {
    return (
      resolveSupportedLocale(this.supportedLocales, locale) ?? this.defaultLocale
    );
  }
}

interface SortedAliases {
  readonly longitudes: Float32Array;
  readonly latitudes: Float32Array;
  readonly belongTo: AliasIds;
}

function getOrCreateSearchSpace(
  searchSpaces: Map<string, LocaleSearchSpace>,
  locale: string,
): LocaleSearchSpace {
  const existing = searchSpaces.get(locale);
  if (existing !== undefined) {
    return existing;
  }
  const created: LocaleSearchSpace = { labels: new Map(), aliases: new Map() };
  searchSpaces.set(locale, created);
  return created;
}

function addPlaceToSearchIndex(
  index: Map<string, GeoPlaceRecord[]>,
  key: string,
  place: GeoPlaceRecord,
): void {
  const normalizedKey = normalizeSearchKey(key);
  const places = index.get(normalizedKey);
  if (places === undefined) {
    index.set(normalizedKey, [place]);
    return;
  }
  places.push(place);
}

function normalizeSearchKey(value: string): string {
  return value.trim().toLowerCase();
}

function makeAddressSearchLabels(address: GeoAddressRecord): readonly string[] {
  const language = address.locale.split("-")[0];
  const labels = new Set<string>([address.label]);
  if (language !== "ja" && language !== "en") {
    return Array.from(labels);
  }

  for (let start = 1; start < address.elements.length; start += 1) {
    const elements = address.elements.slice(start);
    labels.add(
      language === "ja"
        ? elements.join("")
        : [...elements].reverse().join(", "),
    );
  }
  return Array.from(labels);
}

function getSearchLocales(locale: string, defaultLocale: string): readonly string[] {
  return locale === defaultLocale ? [defaultLocale] : [locale, defaultLocale];
}

function resolveSupportedLocale(
  supportedLocales: ReadonlySet<string>,
  locale?: string,
): string | undefined {
  for (const candidate of getLocaleCandidates(locale)) {
    if (supportedLocales.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function getLocaleCandidates(locale?: string): readonly string[] {
  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale === undefined) {
    return [];
  }
  const language = normalizedLocale.split("-")[0];
  return language === normalizedLocale
    ? [normalizedLocale]
    : [normalizedLocale, language];
}

function normalizeLocale(locale?: string): string | undefined {
  const normalizedSeparators = locale
    ?.trim()
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalizedSeparators) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(normalizedSeparators)[0];
  } catch {
    return undefined;
  }
}

function collectPlaceHierarchy(
  matchedPlaces: Iterable<GeoPlaceRecord>,
  countriesByCode: ReadonlyMap<string, GeoPlaceRecord>,
  placesByCountryAndJapaneseLabel: ReadonlyMap<string, GeoPlaceRecord>,
): GeoPlaceRecord[] {
  const resultById = new Map<number, GeoPlaceRecord>();
  for (const matchedPlace of matchedPlaces) {
    const country = countriesByCode.get(matchedPlace.country);
    if (country !== undefined) {
      resultById.set(country.id, country);
    }

    const address = getJapaneseAddress(matchedPlace);
    if (address === undefined) {
      continue;
    }

    let label = "";
    for (const element of address.elements) {
      label += element;
      const place = placesByCountryAndJapaneseLabel.get(
        makeLabelKey(matchedPlace.country, label),
      );
      if (place !== undefined) {
        resultById.set(place.id, place);
      }
    }
  }
  return Array.from(resultById.values());
}

function comparePlacesForEncode(left: GeoPlaceRecord, right: GeoPlaceRecord): number {
  return (
    right.level - left.level ||
    left.country.localeCompare(right.country) ||
    left.id - right.id
  );
}

function comparePlacesByLatitude(left: GeoPlaceRecord, right: GeoPlaceRecord): number {
  return (
    left.latitude - right.latitude ||
    left.longitude - right.longitude ||
    left.id - right.id
  );
}

function sortAliasesByLatitude(
  longitudes: Float32Array,
  latitudes: Float32Array,
  belongTo: AliasIds,
): SortedAliases {
  const indexes = Array.from({ length: latitudes.length }, (_, index) => index);
  indexes.sort((left, right) => {
    return (
      latitudes[left] - latitudes[right] ||
      longitudes[left] - longitudes[right] ||
      belongTo[left] - belongTo[right]
    );
  });

  const sortedLongitudes = new Float32Array(longitudes.length);
  const sortedLatitudes = new Float32Array(latitudes.length);
  const sortedBelongTo: AliasIds =
    belongTo instanceof Uint16Array
      ? new Uint16Array(belongTo.length)
      : new Uint32Array(belongTo.length);

  for (let sortedIndex = 0; sortedIndex < indexes.length; sortedIndex += 1) {
    const sourceIndex = indexes[sortedIndex];
    sortedLongitudes[sortedIndex] = longitudes[sourceIndex];
    sortedLatitudes[sortedIndex] = latitudes[sourceIndex];
    sortedBelongTo[sortedIndex] = belongTo[sourceIndex];
  }

  return {
    longitudes: sortedLongitudes,
    latitudes: sortedLatitudes,
    belongTo: sortedBelongTo,
  };
}

function lowerBoundPlacesByLatitude(
  places: readonly GeoPlaceRecord[],
  target: number,
): number {
  let lower = 0;
  let upper = places.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (places[middle].latitude < target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}

function upperBoundPlacesByLatitude(
  places: readonly GeoPlaceRecord[],
  target: number,
): number {
  let lower = 0;
  let upper = places.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (places[middle].latitude <= target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}

function lowerBoundLatitudes(values: Float32Array, target: number): number {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (values[middle] < target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}

function upperBoundLatitudes(values: Float32Array, target: number): number {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (values[middle] <= target) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
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
  const kind = requirePlaceKind(value.kind, filePath, lineNumber);
  validatePlaceKindLevel(kind, level, filePath, lineNumber);
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
    const rawLocale = requireNonEmptyString(
      rawAddress.locale,
      filePath,
      lineNumber,
      `addresses[${index}].locale`,
    );
    const locale = normalizeLocale(rawLocale);
    if (locale === undefined) {
      throw dataError(
        filePath,
        lineNumber,
        `addresses[${index}].locale is invalid: ${rawLocale}`,
      );
    }
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
    const expectedElementCount = level;
    if (
      !Array.isArray(rawAddress.elements) ||
      rawAddress.elements.length !== expectedElementCount
    ) {
      throw dataError(
        filePath,
        lineNumber,
        `addresses[${index}].elements length must be ${expectedElementCount} for ${kind}`,
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
    if (!addressLabelMatchesElements(locale, label, elements)) {
      throw dataError(
        filePath,
        lineNumber,
        `addresses[${index}].label does not match elements for locale ${locale}`,
      );
    }
    const aliases = parseAddressAliases(
      rawAddress.aliases,
      filePath,
      lineNumber,
      `addresses[${index}].aliases`,
    );
    return Object.freeze({
      locale,
      label,
      elements: Object.freeze(elements),
      aliases: Object.freeze(aliases),
    });
  });

  return Object.freeze({
    id,
    level,
    kind,
    country,
    longitude,
    latitude,
    addresses: Object.freeze(addresses),
  });
}

function addressLabelMatchesElements(
  locale: string,
  label: string,
  elements: readonly string[],
): boolean {
  const language = locale.split("-")[0];
  if (language === "ja") {
    return elements.join("") === label;
  }
  if (language === "en") {
    return [...elements].reverse().join(", ") === label;
  }
  return true;
}

function requirePlaceKind(
  value: unknown,
  filePath: string,
  lineNumber: number,
): GeoPlaceKind {
  if (
    value !== "country" &&
    value !== "prefecture" &&
    value !== "municipality" &&
    value !== "special-ward" &&
    value !== "designated-city-ward"
  ) {
    throw dataError(filePath, lineNumber, "invalid place kind");
  }
  return value;
}

function validatePlaceKindLevel(
  kind: GeoPlaceKind,
  level: number,
  filePath: string,
  lineNumber: number,
): void {
  const expectedLevel =
    kind === "country"
      ? 1
      : kind === "prefecture"
        ? 2
        : kind === "designated-city-ward"
          ? 4
          : 3;
  if (level !== expectedLevel) {
    throw dataError(
      filePath,
      lineNumber,
      `place kind ${kind} must have level ${expectedLevel}, got ${level}`,
    );
  }
}

function collectDecodePlaceIds(
  placesById: ReadonlyMap<number, GeoPlaceRecord>,
  placesByLabel: ReadonlyMap<string, GeoPlaceRecord>,
): ReadonlySet<number> {
  const designatedCityParentIds = new Set<number>();

  for (const place of placesById.values()) {
    if (place.kind !== "designated-city-ward") {
      continue;
    }
    const address = getJapaneseAddress(place);
    if (address === undefined || address.elements.length !== 4) {
      throw new Error(`designated-city-ward ${place.id} has no four-element Japanese address`);
    }
    const parentLabel = address.elements.slice(0, -1).join("");
    const parent = placesByLabel.get(makeLabelKey(place.country, parentLabel));
    if (parent === undefined) {
      throw new Error(`designated-city-ward ${place.id} has no parent municipality: ${parentLabel}`);
    }
    if (parent.kind !== "municipality" || parent.level !== 3) {
      throw new Error(
        `designated-city-ward ${place.id} has invalid parent municipality: ${parentLabel}`,
      );
    }
    designatedCityParentIds.add(parent.id);
  }

  const result = new Set<number>();
  for (const place of placesById.values()) {
    if (
      place.kind === "designated-city-ward" ||
      place.kind === "special-ward" ||
      (place.kind === "municipality" && !designatedCityParentIds.has(place.id))
    ) {
      result.add(place.id);
    }
  }
  if (result.size === 0) {
    throw new Error("GeoCoder NDJSON files contain no reverse-geocoding places");
  }
  return result;
}

function parseAddressAliases(
  value: unknown,
  filePath: string,
  lineNumber: number,
  fieldName: string,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw dataError(filePath, lineNumber, `${fieldName} must be an array`);
  }

  const aliases: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const alias = requireNonEmptyString(
      value[index],
      filePath,
      lineNumber,
      `${fieldName}[${index}]`,
    );
    if (seen.has(alias)) {
      throw dataError(filePath, lineNumber, `duplicate address alias: ${alias}`);
    }
    seen.add(alias);
    aliases.push(alias);
  }
  return aliases;
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

function getJapaneseAddress(place: GeoPlaceRecord): GeoAddressRecord | undefined {
  return (
    place.addresses.find((address) => address.locale === JAPANESE_LOCALE) ??
    place.addresses.find(
      (address) => address.locale.split("-")[0] === JAPANESE_LOCALE,
    )
  );
}

function makeLabelKey(country: string, label: string): string {
  return `${country}\u0000${label}`;
}

function toPublicPlace(
  place: GeoPlaceRecord,
  locale: string,
  defaultLocale: string,
): GeoPlace {
  const addressLocales =
    locale === defaultLocale ? [defaultLocale] : [defaultLocale, locale];
  const addresses = addressLocales
    .map((addressLocale) =>
      place.addresses.find((address) => address.locale === addressLocale),
    )
    .filter((address): address is GeoAddressRecord => address !== undefined)
    .map((address) =>
      Object.freeze({
        locale: address.locale,
        label: address.label,
        elements: address.elements,
      }),
    );

  return Object.freeze({
    level: place.level,
    kind: place.kind,
    country: place.country,
    longitude: place.longitude,
    latitude: place.latitude,
    addresses: Object.freeze(addresses),
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
