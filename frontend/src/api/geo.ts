import { apiFetch, extractError } from "./client";

export type GeoAddress = {
  locale: string;
  label: string;
  elements: string[];
};

export type GeoPlace = {
  level: number;
  country: string;
  longitude: number;
  latitude: number;
  addresses: GeoAddress[];
};

export async function encodeGeo(query: string, locale = "ja"): Promise<GeoPlace[]> {
  const search = new URLSearchParams();
  search.append("query", query);
  search.append("locale", locale);

  const res = await apiFetch(`/geo/encode?${search.toString()}`, { method: "GET" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
