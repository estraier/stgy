import { decodeGeo } from "@/api/geo";
import type { GeoPlace } from "@/api/geo";
import {
  applyTrackJsonPoiLabels,
  getTrackJsonPoi,
} from "stgy-track/trackjson";
import type { TrackJsonPoiLabelAssignment } from "stgy-track/trackjson";

export async function addTrackJsonPoiLabels(data: unknown): Promise<unknown> {
  const coordinatesByKey = new Map<string, { longitude: number; latitude: number }>();

  getTrackJsonPoi(data).forEach((point) => {
    const longitude = point.coordinates[0];
    const latitude = point.coordinates[1];
    coordinatesByKey.set(`${longitude},${latitude}`, { longitude, latitude });
  });

  const assignments = (await Promise.all(
    Array.from(coordinatesByKey.values()).map(async ({ longitude, latitude }) => {
      const places = await decodeGeo(longitude, latitude, "ja");
      const label = getGeoPlaceLabel(places[0], "ja");
      return label ? { longitude, latitude, label } : undefined;
    }),
  )).filter((assignment): assignment is TrackJsonPoiLabelAssignment => {
    return assignment !== undefined;
  });

  return applyTrackJsonPoiLabels(data, assignments);
}

function getGeoPlaceLabel(
  place: GeoPlace | undefined,
  locale: string,
): string | undefined {
  const address = place?.addresses.find((item) => item.locale === locale) ??
    place?.addresses[0];
  const label = address?.label.trim();
  return label || undefined;
}
