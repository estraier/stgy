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

  // --- 境界判定: 対馬 vs 韓国 ---
  test("Tsushima border check", () => {
    expect(isJapan(34.20, 129.29)).toBe(true); // 対馬 (厳原)
    expect(isJapan(34.65, 129.45)).toBe(true); // 対馬 (上対馬)
    expect(isJapan(35.10, 129.04)).toBe(false); // 釜山 (韓国) - 緯度が35度超え
  });

  // --- 境界判定: 与那国 vs 台湾 ---
  test("Yonaguni border check", () => {
    expect(isJapan(24.4550, 122.99)).toBe(true); // 与那国島
    expect(isJapan(25.0330, 121.5654)).toBe(false); // 台北 (台湾) - 経度が122度未満
  });

  // --- 境界判定: 北海道 vs サハリン ---
  test("Hokkaido border check", () => {
    expect(isJapan(45.52, 141.93)).toBe(true); // 宗谷岬
    expect(isJapan(46.60, 142.80)).toBe(false); // サハリン (ロシア) - 緯度が46度超え
  });

  // --- 島嶼部 ---
  test("Remote islands should be Japan", () => {
    expect(isJapan(27.09, 142.19)).toBe(true); // 父島 (小笠原)
    expect(isJapan(24.28, 153.98)).toBe(true); // 南鳥島
    expect(isJapan(20.42, 136.07)).toBe(true); // 沖ノ鳥島
  });

  // --- 明らかに海外 ---
  test("Foreign cities should be false", () => {
    expect(isJapan(21.3069, -157.8583)).toBe(false); // ホノルル (ハワイ)
    expect(isJapan(51.5074, -0.1278)).toBe(false);   // ロンドン
    expect(isJapan(39.9042, 116.4074)).toBe(false);  // 北京
  });
});
