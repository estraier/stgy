export interface GeoAddress {
  readonly locale: string;
  readonly label: string;
  readonly elements: readonly string[];
}

export interface GeoPlace {
  readonly level: number;
  readonly country: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly addresses: readonly GeoAddress[];
}

export interface GeoPlaceRecord extends GeoPlace {
  readonly id: number;
}

export interface GeoAliasRecord {
  readonly longitude: number;
  readonly latitude: number;
  readonly belongTo: number;
}
