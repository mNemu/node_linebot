# node_linebot

Node.js (Express) 製のLINE Bot。`@BOT`へのメンションでコマンドを認識し、Google Calendar/Driveとの連携、
経路検索、メッセージのメールへのダイジェスト転送などを行う。

## できること

`@BOT` にメンションすると以下のコマンドを認識する（`SELF_NAME` で変更可）。

- `nDm` - ダイスロール（例: `@BOT 2D6`)
- `A から B` - Google Maps 経路検索（車・電車）
- `sch view / sch set ...` - Google カレンダーで予定を表示・登録
- `alb list / set / unset / url ...` - 画像/動画の保存先アルバム(Google Drive フォルダ)を管理
- `diet 目標値 目標日 初期値 [開始日]` - 減量ペースの試算
- `cfg list / get / set ...` - 会話ごとの設定(Calendar/Folder/メール転送設定)を管理

メンションなしのメッセージ・スタンプ・画像/動画添付も含め、すべてのメッセージは会話ごとにSQLiteへログされ、
`cfg set recipient ...` が設定されていれば10分デバウンスでダイジェストメールとして転送される。

## 構成

| ディレクトリ/ファイル | 役割 |
|---|---|
| `src/index.js` | Expressサーバー本体。`/webhook` でLINEイベントを受信 |
| `src/handlers/selecter.js` | 受信イベントのディスパッチ、SQLiteへのログ記録 |
| `src/handlers/*.js` | 各コマンド(`dice`/`route`/`diet`/`cfg`/`help`)の実装 |
| `src/line/*.js` | `@line/bot-sdk` を使ったLINE API呼び出し |
| `src/google/calendar.js` / `drive.js` | Calendar API v3 / Drive API v3 |
| `src/google/mail.js` | nodemailer(SMTP)経由でのダイジェストメール送信 |
| `src/lib/db.js` | 会話ごとの設定(cfg)とログ(log)を保存するSQLite(`node:sqlite`)ラッパー |
| `src/lib/cache.js` | プロセス内メモリキャッシュ(node-cache)。プロセス再起動で消える |
| `src/lib/scheduler.js` | `data/triggers.json` にジョブを永続化する自前の遅延ジョブキュー(10分後のメール送信等)。再起動しても保留中のジョブは復元される |
| `src/cron/dailySchedule.js` | `DAILY_SCHEDULE_TARGET` を設定した場合のみ有効になる、5日先の予定を毎日8:00 JSTに通知するバッチ |
| `scripts/cfg.js` | サーバー(SSH)から直接 `cfg` の設定を確認・変更するCLI |
| `scripts/pending.js` | 送信待ちのダイジェストメール一覧を表示するCLI |
| `scripts/test-post.js` | HTTP層を経由せず `selecter` を直接呼び出す簡易動作確認スクリプト |

## セットアップ

### 1. Google Cloud サービスアカウントを準備する

1. GCPプロジェクトを作成し、以下のAPIを有効化する: Google Drive API, Google Calendar API
2. サービスアカウントを作成し、JSON鍵をダウンロードする（`service-account.json`として保存し、リポジトリにはコミットしない）
3. `alb`(Drive)機能を使う場合は、Drive上のベースフォルダをサービスアカウントのメールアドレス (`xxx@yyy.iam.gserviceaccount.com`) と編集者権限で共有する

### 2. LINE Developers でチャネルを準備する

1. Messaging APIチャネルを作成し、チャネルアクセストークン・チャネルシークレットを取得する
2. Webhook URLを `https://<デプロイ先>/webhook` に設定する

### 3. 環境変数を設定する

`.env.example` を `.env` にコピーして値を埋める。

```
cp .env.example .env
```

### 4. メール転送用SMTP(任意)

Gmailの「アプリパスワード」等を`SMTP_USER`/`SMTP_PASS`に設定する（サービスアカウントでのGmail送信はGoogle Workspaceの
ドメイン全体委任が必要になるため、この構成ではSMTP経由の送信を採用している）。設定後、転送したい会話で
`@BOT cfg set recipient <アドレス>` を送ると、その会話のメッセージが10分デバウンスでメール転送されるようになる
(`subject`/`replyTo`/`SenderName` も任意で設定可能)。

### 5. カレンダー/アルバム機能を使う会話ごとの設定(任意)

`sch`(カレンダー)・`alb`(Drive)機能を使う会話では、その会話で以下を送って設定する。

```
@BOT cfg set Calendar <GoogleカレンダーID>
@BOT cfg set Folder <Drive フォルダID>
```

サーバー上のシェルから直接設定したい場合は `node scripts/cfg.js` を使う(下記参照)。

### 6. インストールと起動

```
npm install
npm start        # 本番起動
npm run dev       # ファイル変更を監視して再起動
```

### 7. 動作確認

`npm run test:webhook -- "@BOT 2D6"` で、HTTP層を経由せず`selecter`を直接呼び出して疎通確認ができる
（`.env`の各種認証情報が実際に有効である必要がある）。

## 運用コマンド(サーバー上のシェルから)

```
node scripts/cfg.js snames                        # 既知の会話一覧(sname + 直近の発言者名)
node scripts/cfg.js list <sname>                   # ある会話の設定を一覧表示
node scripts/cfg.js get <sname> <key>               # 設定値を1つ取得
node scripts/cfg.js set <sname> <key> <value>       # 設定値を1つ変更
node scripts/pending.js                              # 送信待ちのダイジェストメール一覧
```

対応キー: `Calendar`, `Folder`, `recipient`, `subject`, `replyTo`, `SenderName`

## 注意事項

- `data/` ディレクトリは会話ごとの設定/ログ(`linebot.sqlite`)と保留中のメール送信ジョブ(`triggers.json`)の
  永続化に使うため、デプロイ先でも書き込み可能な永続ボリュームにすること
  （コンテナ環境で揮発するディスクの場合、再起動時にデータが消える）。
- キャッシュ (`src/lib/cache.js`) はプロセス内メモリのみで、複数インスタンス間や再起動をまたいで共有されない。
  複数インスタンスでスケールする場合はRedis等への置き換えを検討すること。
