/**
 * Japan Area Definitions (High Precision Heuristic)
 * Array of rectangles: [minLat, minLon, maxLat, maxLon]
 * Defined to cover Japanese landmass with high precision without using heavy polygon data.
 * tuned to distinguish borders with Busan (Korea) and Taiwan.
 */
export const JAPAN_AREAS: [number, number, number, number][] = [
  [41.2, 139.3, 45.8, 146.0], // 1. Hokkaido Main & Okushiri/Rebun/Rishiri
  [43.3, 145.0, 45.7, 149.0], // 2. Northern Territories (Etorofu/Kunashiri/Shikotan/Habomai)
  [34.8, 136.5, 41.6, 142.5], // 3. Honshu East (Tohoku/Kanto/Chubu/Hokuriku)
  [32.5, 130.5, 38.0, 137.0], // 4. Honshu West (Kinki/Chugoku/Shikoku) - Adjusted to exclude Busan
  [30.9, 129.3, 34.2, 132.2], // 5. Kyushu Main
  [34.0, 129.1, 34.8, 129.6], // 6. Tsushima (Busan is Lat 35.0+)
  [32.5, 128.5, 33.3, 129.2], // 7. Goto Islands
  [28.0, 128.0, 31.0, 131.5], // 8. Satsunan Islands (Yakushima/Tanegashima)
  [27.0, 128.0, 28.5, 130.5], // 9. Amami Islands
  [26.0, 127.0, 27.2, 128.5], // 10. Okinawa Main Island
  [24.0, 122.3, 25.0, 126.0], // 11. Sakishima Islands (Taiwan is Lon 122.0-)
  [25.8, 131.1, 26.0, 131.4], // 12. Daito Islands
  [32.0, 139.0, 35.0, 140.5], // 13. Izu Islands
  [20.0, 136.0, 32.0, 143.0], // 14. Ogasawara Islands
  [24.2, 153.9, 24.4, 154.1], // 15. Minamitorishima
  [20.4, 136.0, 20.5, 136.1], // 16. Okinotorishima
];
