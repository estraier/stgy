# stgy-geocoder

Node.js用の静的ジオコーダーです。地名レコードはオブジェクトとして保持し、補助点はロード後に`Float32Array`と`Uint16Array`または`Uint32Array`へ格納します。

## 使用例

```ts
import { GeoCoder } from "stgy-geocoder";

const geoCoder = new GeoCoder(["packages/geocoder/data/geo-japan.ndjson"]);

console.log(geoCoder.encode("埼玉県所沢市", "ja"));
console.log(geoCoder.encode("所沢", "ja"));
console.log(geoCoder.encode("横浜市鶴見区", "ja"));
console.log(geoCoder.decode(139.4689, 35.7994, "ja"));
```

`encode`は地名ラベルの完全一致に加えて、住所の`aliases`にある別名も扱います。完全ラベルを優先し、同じ別名が複数の場所にある場合は一致した場所をすべて返します。一致した各場所について`elements`の先頭からの結合文字列を使って階層を復元し、重複を除いたうえでレベル降順・ID昇順の安定した順序で返します。

## levelとkind

`level`は住所要素の階層数です。地理的な粒度や自治体としての法的な位置付けは`kind`で表します。

| level | kind | 例 |
| --- | --- | --- |
| 1 | `prefecture` | 神奈川県 |
| 2 | `municipality` | 神奈川県横浜市、埼玉県所沢市 |
| 2 | `special-ward` | 東京都世田谷区 |
| 3 | `designated-city-ward` | 神奈川県横浜市鶴見区 |

政令指定都市の行政区は市とは別の検索レコードとして収録します。ただし逆ジオコーディングでは、市全体の代表点・補助点を候補にせず、各行政区の代表点・補助点を使用します。東京都の特別区と通常の市町村は従来どおり逆ジオコーディング候補です。

`decode`は上記の逆ジオコーディング候補の代表点と補助点を読み込み後に緯度順へ並べ替えます。検索時は緯度が南北10 km以内にある範囲を二分探索で切り出し、その候補だけを走査します。最近傍点が10 kmより遠い場合は空配列を返します。NDJSON内のレコード順には依存しません。

現状では`locale`引数を受け取りますが、日本語住所だけを使用します。

## データ生成

```sh
npm run generate:japan --workspace packages/geocoder
```

このコマンドは次を行います。

1. Python仮想環境を`packages/geocoder/.cache/`へ作成する。
2. 必要なPythonパッケージを導入する。
3. N03 2026年版の原本を`source-data/N03-2026/`へ取得する。
4. `N03_004`から市町村・東京都特別区を、`N03_005`から政令指定都市の行政区を生成する。
5. 政令指定都市については区ポリゴンを合成して市のレコードも生成する。
6. 通常の市町村・東京都特別区・政令指定都市の行政区に、2 km間隔の補助点と0.25 km²以上の未収録構成面の補完点を生成する。
7. `data/geo-japan.ndjson`を書き出す。
8. 1 km検証グリッドで最近傍判定を検証する。
