import { isJapan } from "./geo";

describe("isJapan", () => {
  // --- 主要都市 ---
  test("Major cities should be Japan", () => {
    expect(isJapan(35.6895, 139.6917)).toBe(true); // 東京
    expect(isJapan(34.6937, 135.5023)).toBe(true); // 大阪
    expect(isJapan(43.0618, 141.3545)).toBe(true); // 札幌
    expect(isJapan(33.5904, 130.4017)).toBe(true); // 福岡
    expect(isJapan(26.2124, 127.6809)).toBe(true); // 那覇
  });

  // --- 伊豆半島・伊豆諸島 ---
  test("Izu Peninsula and Izu Islands should be Japan", () => {
    expect(isJapan(34.65109188, 138.85852936)).toBe(true); // 南伊豆町
    expect(isJapan(34.67953322, 138.94531551)).toBe(true); // 下田市
    expect(isJapan(34.75, 139.36)).toBe(true); // 伊豆大島
    expect(isJapan(30.48, 140.30)).toBe(true); // 鳥島
    expect(isJapan(29.79, 140.34)).toBe(true); // 孀婦岩
  });

  // --- 境界判定: 対馬 vs 韓国 ---
  test("Tsushima border check", () => {
    expect(isJapan(34.20, 129.29)).toBe(true); // 対馬 (厳原)
    expect(isJapan(34.65, 129.45)).toBe(true); // 対馬 (上対馬)
    expect(isJapan(35.10, 129.04)).toBe(false); // 釜山 (韓国)
  });

  // --- 境界判定: 与那国・尖閣 vs 台湾 ---
  test("Southwestern islands border check", () => {
    expect(isJapan(24.4550, 122.99)).toBe(true); // 与那国島
    expect(isJapan(25.75, 123.47)).toBe(true); // 魚釣島
    expect(isJapan(25.0330, 121.5654)).toBe(false); // 台北 (台湾)
  });

  // --- 境界判定: 北海道 vs サハリン ---
  test("Hokkaido border check", () => {
    expect(isJapan(45.52, 141.93)).toBe(true); // 宗谷岬
    expect(isJapan(46.60, 142.80)).toBe(false); // サハリン (ロシア)
  });

  // --- 南西諸島・大東諸島 ---
  test("Southwestern remote islands should be Japan", () => {
    expect(isJapan(26.34, 126.80)).toBe(true); // 久米島
    expect(isJapan(25.95, 131.30)).toBe(true); // 北大東島
    expect(isJapan(25.83, 131.23)).toBe(true); // 南大東島
    expect(isJapan(24.46, 131.18)).toBe(true); // 沖大東島
  });

  // --- 小笠原諸島など ---
  test("Pacific remote islands should be Japan", () => {
    expect(isJapan(27.09, 142.19)).toBe(true); // 父島
    expect(isJapan(26.64, 142.16)).toBe(true); // 母島
    expect(isJapan(24.78, 141.32)).toBe(true); // 硫黄島
    expect(isJapan(24.28, 153.98)).toBe(true); // 南鳥島
    expect(isJapan(20.42, 136.07)).toBe(true); // 沖ノ鳥島
  });

  // --- 離島の境界分割 ---
  test("Takeshima should not include Ulleungdo", () => {
    expect(isJapan(37.24, 131.87)).toBe(true); // 竹島
    expect(isJapan(37.48, 130.90)).toBe(false); // 鬱陵島 (韓国)
  });

  // --- 明らかに海外 ---
  test("Foreign cities should be false", () => {
    expect(isJapan(21.3069, -157.8583)).toBe(false); // ホノルル (ハワイ)
    expect(isJapan(51.5074, -0.1278)).toBe(false); // ロンドン
    expect(isJapan(39.9042, 116.4074)).toBe(false); // 北京
  });
});
