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

/etc/postfix/main.cfを編集する。単純化のために、dbmx.netというドメインで、サブドメインを作らずに運用する。Webサーバ用に取得したLet's Encryptの証明書を再利用する。サブドメインを作らなければそれが容易になる。

```
myhostname = dbmx.net
mydomain = dbmx.net
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
smtpd_tls_cert_file = /etc/letsencrypt/live/dbmx.net/fullchain.pem
smtpd_tls_key_file  = /etc/letsencrypt/live/dbmx.net/privkey.pem
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

SASL認証のためのアカウントを作る必要がある。ここでは postfix@dbmx.net というアカウントを作る

```
$ sudo saslpasswd2 postfix -u dbmx.net
```

確認は以下のコマンドで行う。"postfix@dbmx.net: userPassword" と表示されたら成功である。

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
$ nslookup -type=TXT dbmx.net
Server:		10.52.1.50
Address:	10.52.1.50#53

Non-authoritative answer:
dbmx.net	text = "v=spf1 ip4:49.212.133.108 -all"
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
$ swaks --to youraddress@example.com --server dbmx.net:587 --from noreply@dbmx.net --auth-user postfix@dbmx.net --auth-password abcdefg --auth PLAIN --header "Subject: test" --body "test1" --tls
```

リモートマシンとリレー用SMTPサーバとの通信に失敗するなら、swaskにエラーログが出る。swaskが成功してもメールが届かなければ、サーバ上の /var/log/mail.log にエラーが出ているので、それに応じて対処する。

## ローカルSMTPサーバの構築

開発用にローカルSMTPサーバを立ち上げるには、docker-compose.ymlに以下のように書けば良い。実際には値はハードコードせずに.envに定義した変数の値を用いる。

```
  smtp:
    image: boky/postfix
    restart: always
    environment:
      RELAYHOST: [dbmx.net]:587
      RELAYHOST_USERNAME: postfix@dbmx.net
      RELAYHOST_PASSWORD: abcdef
      ALLOWED_SENDER_DOMAINS: dbmx.net
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
      - FAKEBOOK_SMTP_HOST=smtp
      - FAKEBOOK_SMTP_PORT=587
      - FAKEBOOK_SMTP_SENDER_ADDRESS=noreply@dbmx.net
    volumes:
      - ./backend:/app
    command: npm run mail-worker
```

Node.jsでSMTPを喋るには、以下のようなコードを書くことになる。

```
import nodemailer, { Transporter } from "nodemailer";

const transporter: Transporter = nodemailer.createTransport({
  host: process.env.FAKEBOOK_SMTP_HOST,
  port: Number(process.env.FAKEBOOK_SMTP_PORT),
  secure: false,
  tls: {
    rejectUnauthorized: false,
  },
});

await transporter.sendMail({
  from: process.env.FAKEBOOK_SMTP_SENDER_ADDRESS,
  to: "foobar@example.com",
  subject: "Hello World",
  text: "This is a pen.",
});

transporter.close();
```

ローカルSMTPサーバを置いてDMZで運用することが、secure: falseにできる条件である。外部のSMTPサーバと直接通信する場合には、クライアント側でも認証の設定をちゃんと書く必要がある。

なお、今回のリレー用SMTPサーバの設定だと、DKIMの署名などの措置を取っていないので、GMail等ではスパム判定される確率が高い。本番環境では、自前のSMTPサーバの設定を頑張るよりは、商用のサーバを使った方が楽である。
