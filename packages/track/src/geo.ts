export const JAPAN_AREAS: [number, number, number, number][] = [
  [41.2, 139.3, 45.8, 146.0], // 1. Hokkaido Main & Okushiri/Rebun/Rishiri
  [43.3, 145.0, 45.7, 149.0], // 2. Northern Territories (Etorofu/Kunashiri/Shikotan/Habomai)
  [33.0, 136.5, 41.6, 142.5], // 3. Honshu East (including the Izu Peninsula)
  [32.5, 130.5, 36.6, 137.0], // 4. Honshu West (Kinki/Chugoku/Shikoku), excluding Ulleungdo
  [37.1, 131.7, 37.4, 132.0], // 5. Takeshima
  [30.9, 129.3, 34.2, 132.2], // 6. Kyushu Main
  [34.0, 129.1, 34.8, 129.6], // 7. Tsushima (Busan is Lat 35.0+)
  [32.5, 128.5, 33.3, 129.2], // 8. Goto Islands
  [28.0, 128.0, 31.0, 131.5], // 9. Satsunan Islands (Yakushima/Tanegashima/Tokara)
  [27.0, 128.0, 28.5, 130.5], // 10. Amami Islands
  [25.5, 126.0, 27.5, 129.0], // 11. Okinawa Main Island and Kumejima
  [23.5, 122.3, 26.5, 126.5], // 12. Sakishima and Senkaku Islands (excluding Taiwan)
  [24.0, 130.5, 26.5, 132.0], // 13. Daito Islands (Kita/Minami/Oki-Daito)
  [28.5, 138.0, 35.2, 141.0], // 14. Izu Peninsula and Izu Islands
  [23.0, 139.5, 28.5, 143.5], // 15. Ogasawara and Volcano Islands
  [23.5, 153.0, 25.0, 155.0], // 16. Minamitorishima
  [19.5, 135.0, 21.0, 137.0], // 17. Okinotorishima
];

export const isJapan = (lat: number, lon: number): boolean => {
  return JAPAN_AREAS.some(([minLat, minLon, maxLat, maxLon]) => {
    return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
  });
};
