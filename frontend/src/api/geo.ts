import { appendQueryHash } from "@/utils/queryHash";
import { apiFetch, extractError } from "./client";

export type GeoAddress = {
  locale: string;
  label: string;
  elements: string[];
};

export type GeoPlaceKind =
  | "country"
  | "prefecture"
  | "municipality"
  | "special-ward"
  | "designated-city-ward";

export type GeoPlace = {
  level: number;
  kind: GeoPlaceKind;
  country: string;
  longitude: number;
  latitude: number;
  addresses: GeoAddress[];
};

export async function encodeGeo(query: string, locale?: string): Promise<GeoPlace[]> {
  const search = new URLSearchParams();
  search.append("query", query);
  if (locale) search.append("locale", locale);
  await appendQueryHash(search);

  const res = await apiFetch(`/geo/encode?${search.toString()}`, { method: "GET" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

export async function decodeGeo(
  longitude: number,
  latitude: number,
  locale?: string,
): Promise<GeoPlace[]> {
  const search = new URLSearchParams();
  search.append("longitude", String(longitude));
  search.append("latitude", String(latitude));
  if (locale) search.append("locale", locale);
  await appendQueryHash(search);

  const res = await apiFetch(`/geo/decode?${search.toString()}`, { method: "GET" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
