# メディアサーバの構築と運用

## 前提条件

画像などのメディアデータを扱う場合、データベースにバイナリを入れたり、ファイルシステムにファイルを置いたりする方法だと、運用が面倒くさい。可用性の確保や容量制限やバックアップの作成に独自の手順を必要とするからだ。それよりは、いわゆるクラウドストレージを使ったほうが楽だ。

STGYではストレージサービスとしてAmazon S3を使うことにしていて、開発中はMinIOのDockerインスタンスを立ててS3のエミュレーションをしている。本文書では、S3のデータ管理の概要について述べる。また、開発環境および本番環境での構築と運用についても述べる。

## S3のデータ管理の概要

S3は、バケットという単位の中に任意の名前付きオブジェクトを格納する仕組みである。言い換えると、バケット毎にkey-valueストアがあり、キーがファイル名、valueがオブジェクトのバイナリということになる。キーには "/" で区切ったディレクトリ構造を模した文字列を使うことが通例だが、"/" に特別な意味はなく、オブジェクトはキーの完全一致で識別されるとともに、キーの前方一致によるリスト機能が提供されるだけである。

投稿内に埋め込む画像は "stgy-images" バケット内に置かれる。その中に、以下の構造でオブジェクトが置かれる。元画像はクライアントから直接アップロードされ、サムネイルはシステム側で自動的に作られる。

- /{userId}/masters/{revYYYYMM}/{revTs}{rnd}(_icon)?.{ext}
- /{userId}/thumbs/{revYYYYMM}/{revTs}{rnd}_icon.webp

{userId}はユーザIDである。{revYYYYMM}は、作成日時のYYYYMM値を999999から引いた値である。{revTs}は作成日時のUNIXミリ秒から999999999999999を引いた値である。{rnd}は衝突回避のための8桁の16進数ランダム値である。以下に例を示す。

- 00000000-0000-0000-0001-000000000003/masters/797491/8244600348025c20d1da7.jpg
- 00000000-0000-0000-0001-000000000003/thumb/797491/8244600348025c20d1da7_image.webp

S3では、キーは文字列の辞書順で並べられる。ユーザIDを接頭させると、ユーザごとのオブジェクトを検索できるようになる。また、その後に最大値の減算表現にした日付をキー使うことで、新しい順にキーが並ぶことになる。YYYYMMを単位とすることで、月ごとにオブジェクトが分類できるので、月のクォータ管理ができる。

アバター画像など、個々のユーザが一つしか持たない、プロファイル系の画像は、"stgy-profiles" というバケット内に置かれる。その中に、以下の構造でオブジェクトが置かれる。元画像はクライアントから直接アップロードされ、サムネイルはシステム側で自動的に作られる。

- /{userId}/masters/{type}.{ext}
- /{userId}/thumbs/{type}_icon.webp

{userId}はユーザIDである。{type}は、データの種類を表すが、現状では "avatar" のみである。以下に例を示す。

- stgy-profiles/00000000-0000-0000-0001-000000000003/masters/avatar.png
- stgy-profiles/00000000-0000-0000-0001-000000000003/thumbs/avatar_icon.webp

プロファイル系の画像は、ユーザと種別ごとに単一なので、画像単体のサイズのみが制限され、クォータの制限はない。

以上の命名規則によって、DBでキーやメタデータを管理することなく、ストレージサービスのみで、メディアデータを管理することができる。

## 本番環境での設定

メディア関係の設定も環境変数で管理されている。開発中には.envファイルを使い、MinIO前提の設定が書いてある。本番環境では、バックエンドとフロントエンドに渡す環境変数をS3用に書き換えることになる。

バックエンドに渡す環境変数は以下のものである。

- STGY_STORAGE_DRIVER : 現状、"s3" 決め打ち
- STGY_STORAGE_S3_ENDPOINT : S3のAPIを叩くエンドポイント
- STGY_STORAGE_S3_REGION : リージョンの識別子
- STGY_STORAGE_S3_ACCESS_KEY_ID : S3を使うAWSのアカウントID
- STGY_STORAGE_S3_SECRET_ACCESS_KEY : S3のアクセスパスワード（秘匿情報）
- STGY_STORAGE_S3_FORCE_PATH_STYLE : 公開URLの "ENDPOINT/BUCKET/KEY" と "BUCKET.ENDPOINT/KEY" の切り替え
- STGY_STORAGE_S3_BUCKET_PREFIX : バケット名の接頭辞
- STGY_STORAGE_S3_PUBLIC_BASE_URL : 公開URLの接頭辞

本番環境では、以下の設定が無難である。

- STGY_STORAGE_DRIVER=S3
- STGY_STORAGE_S3_ENDPOINT= (空文字列にすると自動選択される）
- STGY_STORAGE_S3_REGION=
- STGY_STORAGE_S3_ACCESS_KEY_ID :
- STGY_STORAGE_S3_SECRET_ACCESS_KEY :
- STGY_STORAGE_S3_FORCE_PATH_STYLE :
- STGY_STORAGE_S3_BUCKET_PREFIX :
- STGY_STORAGE_S3_PUBLIC_BASE_URL :










```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowGetFromOurSite",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::stgy-images/*",
        "arn:aws:s3:::stgy-profiles/*"
      ],
      "Condition": {
        "StringLike": {
          "aws:Referer": [
            "https://stgy.example/*",
            "https://www.stgy.example/*"
          ]
        }
      }
    },
    {
      "Sid": "AllowGetWhenRefererIsEmpty",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": [
        "arn:aws:s3:::stgy-images/*",
        "arn:aws:s3:::stgy-profiles/*"
      ],
      "Condition": {
        "Null": { "aws:Referer": "true" }
      }
    }
  ]
}
```