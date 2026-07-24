export interface GeoAddress {
  readonly locale: string;
  readonly label: string;
  readonly elements: readonly string[];
}

export type GeoPlaceKind =
  | "prefecture"
  | "municipality"
  | "special-ward"
  | "designated-city-ward";

export interface GeoPlace {
  readonly level: number;
  readonly kind: GeoPlaceKind;
  readonly country: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly addresses: readonly GeoAddress[];
}

export interface GeoAddressRecord extends GeoAddress {
  readonly aliases: readonly string[];
}

export interface GeoPlaceRecord extends Omit<GeoPlace, "addresses"> {
  readonly id: number;
  readonly addresses: readonly GeoAddressRecord[];
}

export interface GeoAliasRecord {
  readonly longitude: number;
  readonly latitude: number;
  readonly belongTo: number;
}
