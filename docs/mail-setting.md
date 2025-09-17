## design Docとは

中規模以上の全ての開発プロジェクトを開始する際に執筆を求められる実装計画書のこと。複数人でやるプロジェクトはだいたいこれに当てはまる。TL（techlead）が起草して、主要メンバーとPMのレビューを経てapprovalを経たものが効力を発する。プロジェクトのリリース承認の際に提出が必須となる文書のひとつ。Google Docsで書くことが多い。

本来は、PRD（project design doc）で何をするか（what）を決め、それをどうやって実現するか（how）をdesign docに書くべきだが、G社では逆のパターンが多い。エンジニア主導でプロジェクトが始まると、まずはアイデアをまとめてdesign docを書きはじめ、そのドラフトを見せて乗り気になるPMを探してきて、PRDを書いてもらう。よって、whatの部分もだいたいdesign docに書いてある。

内容的には完全な技術文書であり、経験のあるエンジニアがそれを読めば誰でも同じシステム設計に至るというのに必要十分な情報を記載することが求められる。偉い人はだいたいエンジニア畑の人なので、彼らの査読に耐える品質でないと通らない。なお、個人レベルの実験や小規模の開発ではtechnical memorandum的なものを書くことが多い。チームによってはにMarkdownをコードベース内に置くポリシーにして、チームのサイトにリンク集を置くこともある。

### design docの内容

- project name
  - 何でも良い。Damoclesみたいなコードネームの場合と、sensitive translation rewriterみたいな記述的な名前の場合がある。
  - リリース時の名前は別のチームが勝手につける

- reviewers and approvers
  - レビューする人と承認する人のリスト。Google Docsのプラグインで、各自がLGTMやApproveのフラグを立てるようになっている。

- goal
  - そのプロジェクトが達成すべき目的。どこかのページのCTRを上げるとか、何何語のPVをいくつ上げるとか
  - ノンゴール（ゴールじゃないもの）をいっぱい書く。そうすることでゴールが明確化する。

- background
  - サービスやシステムの現状を説明し、なぜそのgoalを達成する必要があるのかというストーリーを書く
  - 推測を書くと確実に突っ込まれるので、自分や誰かが集計した数値や実験結果を乗せないといけない

- system architecure
  - システムアーキテクチャを書く。大規模なシステムはやたら長くなるし、小規模なシステムは短くて済む。
  - 言葉による説明とともに図解があることが多い。
  - 調査・実験系のプロジェクトの場合には代わりに調査計画や実験計画を書く。
  - 利用するコンピューティングリソースについても詳述する

- details
  - 重要コンポーネントに関してはアルゴリズムまで詳細に記述する。数式がめっちゃ出てくる。
  - スケーラビリティやアベイラビリティやセキュリティの話をセクションを分けて記述することも多い。
  - パフォーマンスに関しては検証環境での実測値を書かないと通らない
  - サブシステムの境界がAPIで切れる場合にはそれも記述する。
  - 既存コンポーネントを再利用することが多いので、細かい話はそちらのdesign docにリンクをを貼って任せる。
  - 開発を進めながら旺盛に更新していく、リリース前に偉い人に見せるので、ちゃんとメンテする動機づけがある。

- metrics/imact
  - ゴールが達成と非達成の判断は必ず定量的に下す必要があり、その基準と測定方法を書く。
  - 達成目標以外の数値をimpactとして列挙する
  - 撤退基準のmetricも書くことが多く、それを明言することで承認者を安心させられる。

- planning
  - 開発の日程や体制について書く。

- caveat
  - 数値には現れない潜在的なリスクとその対策。これも承認者から突っ込まれる前に自分で挙げておく方が良い。

- history
  - 改訂履歴。全ての変更はGoogle Docsで履歴が見られるが、区切りのよいところで一応署名する。

## PRDとは

design docだけでは事業的な視点が不足するため、主にそれについて記述する文書である。PMの最大の仕事は、PRDをうまいこと書いて偉い人の会議に通して、プロジェクト継続やリリース決定の承認を得ることである。PMはそのためにエンジニアと密接に関わってプロジェクトの内容の把握に務める。基本的にPMもエンジニア上がりが多いので、そこそこ仕上がったdesign docを渡しさえすれば、うまいこと書いてくれる。そのことを偉い人も知っているので、大事なことはむしろdesign docに書いてあるという暗黙の了解がある。

### PRDの内容

- goal
  - そのプロジェクトが達成すべき目的。部門のKPIにどう貢献するかみたいな視点で書かれる。
  - ここでもノンゴールをいっぱい書いて、スコープを明確化する

- background
  - マーケティング分析やユーザ行動分析などを踏まえて、なぜその機能やサービスが必要なのかを述べる

- requirements
  - 機能要件：主要な機能やユーザビリティについて図なども用いて説明する。
  - 非機能要件：性能（レイテンシ、スループット）やセキュリティなどについて述べる

- project management
  - 開発体制（エンジニア、UXデザイナ、その他）について
  - 利用するコンピューティングリソースとそのコストの概算
  - スケジュールを線表などで示す

## その他

プロジェクトの性質に応じて、UXドキュメント、セキュリティドキュメント、リーガルドキュメントなどが求められることもある。そのあたりはPMがうまいことやってくれるので、エンジニアはあんまり気にしないで済む。おかげで私はあまりそれらに詳しくない。









# メールサーバの構築と運用

## 前提条件

任意のWebサービスにおいて、ユーザ登録やパスワードリセットなどのためにユーザが指定した任意のメールアドレスにEメールを送る必要がある。GoogleやAmazonなどの商用SMTPサービスを使うには有料の契約をする必要があるが、開発中にその契約をするのは煩雑だ。よって、自前でSMTPサーバを運用したくなる。

ネットに繋がったLinuxサーバがあり、その管理者権限を持っているならば、自分でPostfixを入れて、SMTPサーバとして機能させるのは簡単だ。一方、開発環境におけるWebシステムが外部のSMTPサーバを利用するには、認証機構をWebシステム側に組み込む必要があるが、それの煩雑さを避けたい。よって、開発環境にSMTPサーバを立てて、そこから外部の自前のSMTPサーバにメールをリレーする。開発環境のSMTPサーバはDockerインスタンスで十分である。

```
[開発中のWebシステム]
 |（ローカルなので認証不要）
[ローカルSMTPサーバ]
 |（SSL越しのパスワード認証）
[リレー用SMTPサーバ]
 |（SPFやDKIMによる認証）
[他のSMTPサーバ]
```

本番稼働ではリレー用SMTPサーバを省いて、ローカルSMTPサーバが商用SMTPサーバに接続する構成にする。

## リレー用SMTPサーバの構築

Debian系を前提とする。以下のようにPostfixをインストールする。

```
$ sudo apt update
$ sudo apt install postfix libsasl2-modules
```

システム起動時にPostfixも自動起動するようにしておく。

```
$ sudo systemctl enable postfix
$ sudo systemctl start postfix
```

/etc/postfix/main.cfを編集する。単純化のために、stgy.jpというドメインで、サブドメインを作らずに運用する。Webサーバ用に取得したLet's Encryptの証明書を再利用する。サブドメインを作らなければそれが容易になる。

```
myhostname = stgy.jp
mydomain = stgy.jp
myorigin = $mydomain

mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain

inet_interfaces = all
inet_protocols = all

mynetworks = 127.0.0.0/8, [::1]/128

mailbox_size_limit = 0
recipient_delimiter = +

smtpd_recipient_restrictions =
    permit_mynetworks,
    permit_sasl_authenticated,
    reject_unauth_destination

# SASL認証の有効化
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous
smtpd_sasl_local_domain = $mydomain
smtpd_sasl_path = smtpd
broken_sasl_auth_clients = yes

# TLS通信の設定
smtpd_tls_cert_file = /etc/letsencrypt/live/stgy.jp/fullchain.pem
smtpd_tls_key_file  = /etc/letsencrypt/live/stgy.jp/privkey.pem
smtpd_use_tls = yes
smtpd_tls_security_level = may
smtp_tls_security_level = may
smtp_tls_session_cache_database = btree:${data_directory}/smtp_scache

maillog_file = /var/log/mail.log
message_size_limit = 10485760
alias_maps = hash:/etc/aliases
alias_database = hash:/etc/aliases
append_dot_mydomain = no
biff = no
```

/etc/postfix/master.cfを編集する。以下の行を書き換える。submissionを有効にするのと、chrootをnにするのが重要である。

```
smtp       inet  n       -       n       -       -       smtpd

submission inet n       -       n       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_recipient_restrictions=permit_mynetworks,permit_sasl_authenticated,reject_unauth_destination
```

SASL認証のためのアカウントを作る必要がある。ここでは postfix@stgy.jp というアカウントを作る

```
$ sudo saslpasswd2 postfix -u stgy.jp
```

確認は以下のコマンドで行う。"postfix@stgy.jp: userPassword" と表示されたら成功である。

```
$ sudo sasldblistusers2
```

Postfixを再起動する。

```
$ sudo systemctl reload postfix
```

DNSの設定で、サブドメインなしのTXTレコードに以下の値を加える。ドメインを取得した際のサイトでこの操作を行う。これをしないとGMail等のサーバに受け取りを拒否されてしまう。

```
v=spf1 ip4:49.212.133.108 -all
```

nslookupで、設定が反映されていることを確認する。

```
$ nslookup -type=TXT stgy.jp
Server:		10.52.1.50
Address:	10.52.1.50#53

Non-authoritative answer:
stgy.jp	text = "v=spf1 ip4:49.212.133.108 -all"
```

ファイアウォールを設定して、25番ポートと587番ポートを開く。

```
$ sudo ufw allow 25/tcp
$ sudo ufw allow 587/tcp
```

確認は以下のコマンドで行う。

```
$ sudo ufw status
```

リモートの適当なマシンから疎通確認を行う。swaskコマンドを使うと以下のようになる。宛先とパスワードの部分は実際の値に読み替えること。

```
$ swaks --to youraddress@example.com --server stgy.jp:587 --from noreply@stgy.jp --auth-user postfix@stgy.jp --auth-password abcdefg --auth PLAIN --header "Subject: test" --body "test1" --tls
```

リモートマシンとリレー用SMTPサーバとの通信に失敗するなら、swaskにエラーログが出る。swaskが成功してもメールが届かなければ、サーバ上の /var/log/mail.log にエラーが出ているので、それに応じて対処する。

## ローカルSMTPサーバの構築

開発用にローカルSMTPサーバを立ち上げるには、docker-compose.ymlに以下のように書けば良い。実際には値はハードコードせずに.envに定義した変数の値を用いる。

```
  smtp:
    image: boky/postfix
    restart: always
    environment:
      RELAYHOST: [stgy.jp]:587
      RELAYHOST_USERNAME: postfix@stgy.jp
      RELAYHOST_PASSWORD: abcdef
      ALLOWED_SENDER_DOMAINS: stgy.jp
    ports:
      - 587:587
```

Webシステムからメールを投げる際には、Webサービスとしての処理の中で同期的に処理するのではなく、キャッシュサーバやDBサーバにキューイングするのが普通である。そして、キューを呼んでメース送信処理を行うサブシステムを、任意のインスタンスの上で稼働させる。WebシステムのメールサブシステムからローカルSMTPサーバにつなぐには、ホスト名とポート番号を教えるだけでよい。

```
  mailworker:
    build: ./backend
    depends_on:
      - smtp
    environment:
      - STGY_SMTP_HOST=smtp
      - STGY_SMTP_PORT=587
      - STGY_SMTP_SENDER_ADDRESS=noreply@stgy.jp
    volumes:
      - ./backend:/app
    command: npm run mail-worker
```

Node.jsでSMTPを喋るには、以下のようなコードを書くことになる。

```
import nodemailer, { Transporter } from "nodemailer";

const transporter: Transporter = nodemailer.createTransport({
  host: process.env.STGY_SMTP_HOST,
  port: Number(process.env.STGY_SMTP_PORT),
  secure: false,
  tls: {
    rejectUnauthorized: false,
  },
});

await transporter.sendMail({
  from: process.env.STGY_SMTP_SENDER_ADDRESS,
  to: "foobar@example.com",
  subject: "Hello World",
  text: "This is a pen.",
});

transporter.close();
```

ローカルSMTPサーバを置いてDMZで運用することが、secure: falseにできる条件である。外部のSMTPサーバと直接通信する場合には、クライアント側でも認証の設定をちゃんと書く必要がある。

なお、今回のリレー用SMTPサーバの設定だと、DKIMの署名などの措置を取っていないので、GMail等ではスパム判定される確率が高い。本番環境では、自前のSMTPサーバの設定を頑張るよりは、商用のサーバを使った方が楽である。
