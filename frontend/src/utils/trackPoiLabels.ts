import { decodeGeo } from "@/api/geo";
import type { GeoAddress, GeoPlace } from "@/api/geo";
import { getLocaleCandidates, normalizeLocale } from "@/utils/locale";
import {
  applyTrackJsonPoiLabels,
  getTrackJsonPoi,
} from "stgy-track/trackjson";
import type { TrackJsonPoiLabelAssignment } from "stgy-track/trackjson";

export async function addTrackJsonPoiLabels(
  data: unknown,
  locale?: string,
): Promise<unknown> {
  const coordinatesByKey = new Map<string, { longitude: number; latitude: number }>();

  getTrackJsonPoi(data).forEach((point) => {
    const longitude = point.coordinates[0];
    const latitude = point.coordinates[1];
    coordinatesByKey.set(`${longitude},${latitude}`, { longitude, latitude });
  });

  const assignments = (await Promise.all(
    Array.from(coordinatesByKey.values()).map(async ({ longitude, latitude }) => {
      const places = await decodeGeo(longitude, latitude, locale);
      const label = getGeoPlaceLabel(places[0], locale);
      return label ? { longitude, latitude, label } : undefined;
    }),
  )).filter((assignment): assignment is TrackJsonPoiLabelAssignment => {
    return assignment !== undefined;
  });

  return applyTrackJsonPoiLabels(data, assignments);
}

function getGeoPlaceLabel(
  place: GeoPlace | undefined,
  locale?: string,
): string | undefined {
  let address: GeoAddress | undefined;
  for (const candidate of getLocaleCandidates(locale)) {
    address = place?.addresses.find(
      (item) => normalizeLocale(item.locale) === candidate,
    );
    if (address !== undefined) {
      break;
    }
  }
  address ??= place?.addresses[place.addresses.length - 1];
  const label = address?.label.trim();
  return label || undefined;
}
