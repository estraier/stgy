# stgy-geocoder

Node.js用の静的ジオコーダーです。地名レコードはオブジェクトとして保持し、補助点はロード後に`Float32Array`と`Uint16Array`または`Uint32Array`へ格納します。

## 使用例

```ts
import { GeoCoder } from "stgy-geocoder";

const geoCoder = new GeoCoder(["packages/geocoder/data/geo-japan.ndjson"]);

console.log(geoCoder.encode("埼玉県所沢市", "ja"));
console.log(geoCoder.decode(139.4689, 35.7994, "ja"));
```

`encode`は地名ラベルの完全一致だけを扱います。一致後、`elements`の先頭からの結合文字列を使って階層を復元し、レベル降順で返します。

`decode`はデータ中の最大レベルの代表点と補助点を読み込み後に緯度順へ並べ替えます。検索時は緯度が南北10 km以内にある範囲を二分探索で切り出し、その候補だけを走査します。最近傍点が10 kmより遠い場合は空配列を返します。NDJSON内のレコード順には依存しません。

現状では`locale`引数を受け取りますが、日本語住所だけを使用します。

## データ生成

```sh
npm run generate:japan --workspace packages/geocoder
```

このコマンドは次を行います。

1. Python仮想環境を`packages/geocoder/.cache/`へ作成する。
2. 必要なPythonパッケージを導入する。
3. N03 2026年版の原本を`source-data/N03-2026/`へ取得する。
4. 2 km間隔の補助点と、0.25 km²以上の未収録構成面の補完点を生成する。
5. `data/geo-japan.ndjson`を書き出す。
6. 1 km検証グリッドで最近傍判定を検証する。
