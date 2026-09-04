# node_linebot

Node.js (Express) 製のLINE Bot。`@BOT`へのメンションでコマンドを認識する。
LINEから叩けるコマンドは意図的に**ダイス**と**ダイエット試算**の2つだけに絞ってあり、
それ以外の設定(メール転送・予定通知など)はサーバー側のCLIから行う。

## できること

`@BOT` にメンションすると以下のコマンドを認識する（`SELF_NAME` で変更可）。

- `nDm` - ダイスロール（例: `@BOT 2D6`)
- `diet 目標値 目標日 初期値 [開始日]` - 減量ペースの試算

このほか、ブラウザで開く汎用の**得点ボード**ページ(`https://<host>/scoreboard/`)がある(下記「得点ボード」参照)。

メンションなしのメッセージ・スタンプ・画像/動画添付も含め、すべてのメッセージは会話ごとにSQLiteへログされ、
`recipient` 設定(サーバー側の `node scripts/cfg.js` で設定)があれば10分デバウンスでダイジェストメールとして転送される
(画像/動画添付はファイル自体の保存はせず、「添付が届いた」旨だけがログ・ダイジェストメールに記録される)。

`DAILY_SCHEDULE_TARGET` を設定した会話には、5日先の予定を毎日8:00 JSTに通知するバッチも(サーバー側の設定のみで)動く。

## 構成

| ディレクトリ/ファイル | 役割 |
|---|---|
| `src/index.js` | Expressサーバー本体。`/webhook` でLINEイベントを受信 |
| `src/handlers/selecter.js` | 受信イベントのディスパッチ(`dice`/`diet`のみ)、SQLiteへのログ記録 |
| `src/handlers/dice.js` / `diet.js` / `help.js` | 各コマンドの実装 |
| `src/line/*.js` | `@line/bot-sdk` を使ったLINE API呼び出し |
| `src/scoreboard/rules.js` / `store.js` / `api.js` | 得点ボードの得点計算(純粋関数)・SQLite保存・JSON API(`/scoreboard/api`) |
| `public/scoreboard/` | 得点ボードのページ本体(HTML/CSS/JS、ログイン無し) |
| `src/google/calendar.js` | Calendar API v3。`DAILY_SCHEDULE_TARGET` の予定通知バッチが使用 |
| `src/google/mail.js` | nodemailer(SMTP)経由でのダイジェストメール送信 |
| `src/lib/db.js` | 会話ごとの設定(cfg)とログ(log)を保存するSQLite(`node:sqlite`)ラッパー |
| `src/lib/cache.js` | プロセス内メモリキャッシュ(node-cache)。プロセス再起動で消える |
| `src/lib/scheduler.js` | `data/triggers.json` にジョブを永続化する自前の遅延ジョブキュー(10分後のメール送信等)。再起動しても保留中のジョブは復元される |
| `src/cron/dailySchedule.js` | `DAILY_SCHEDULE_TARGET` を設定した場合のみ有効になる、5日先の予定を毎日8:00 JSTに通知するバッチ |
| `scripts/cfg.js` | サーバー(SSH)から会話ごとの設定(Calendar/メール転送設定)を確認・変更するCLI。設定用のLINEコマンドは無い |
| `scripts/pending.js` | 送信待ちのダイジェストメール一覧を表示するCLI |
| `scripts/test-post.js` | HTTP層を経由せず `selecter` を直接呼び出す簡易動作確認スクリプト |

## セットアップ

### 1. Google Cloud サービスアカウントを準備する

1. GCPプロジェクトを作成し、以下のAPIを有効化する: Google Calendar API
2. サービスアカウントを作成し、JSON鍵をダウンロードする（`service-account.json`として保存し、リポジトリにはコミットしない）
3. `DAILY_SCHEDULE_TARGET` の予定通知を使う場合は、対象のGoogleカレンダーをサービスアカウントと共有する

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
ドメイン全体委任が必要になるため、この構成ではSMTP経由の送信を採用している）。設定後、転送したい会話について
サーバー上で `node scripts/cfg.js set <sname> recipient <アドレス>` を実行すると、その会話のメッセージが
10分デバウンスでメール転送されるようになる(`subject`/`replyTo`/`SenderName` も任意で設定可能)。

### 5. 会話ごとの設定(任意)

予定通知バッチ(`Calendar`)を使う会話では、サーバー上のシェルから `node scripts/cfg.js` で設定する(下記参照)。
設定用のLINEコマンドは提供していない。

```
node scripts/cfg.js set <sname> Calendar <GoogleカレンダーID>
```

### 6. インストールと起動

```
npm install
npm start        # 本番起動
npm run dev       # ファイル変更を監視して再起動
```

### 7. 動作確認

`npm run test:webhook -- "@BOT 2D6"` で、HTTP層を経由せず`selecter`を直接呼び出して疎通確認ができる
（`.env`の各種認証情報が実際に有効である必要がある）。

## 得点ボード

`https://<host>/scoreboard/` で開く、ゲームを問わず使える得点記録ページ
([YURU](https://github.com/mNemu/YURU) の molkky / golf ページの作りを参考にしたもの)。
スマホでの入力に特化した単独ページで、LINEのアプリ内ブラウザでも普通のブラウザでも動く。

- **ニックネームだけで使う**: ログインは無く、本人はページ上で入力したニックネームで識別する
  (端末に保存され、新しいボードの参加者に自動で追加される)。
- **ゲーム固有のルールは無い**: 参加者をタップして選び、`+1 +2 +3 +5 +10` や任意の点数で加点/減点するだけ。
  合計点の高い順に順位が付く(同点は同順位)。目標点・バースト・ホール・ハンデといった
  モルック/ゴルフ固有の機能や、招待URLによる参加者限定ボードは持たない。
- **複数端末で共有**: 状態はサーバー(SQLite)が持ち、5秒ごとに他の端末の更新を反映する。
  `#board=<id>` 付きのURLを送れば同じボードを開ける。ボード開始後に「参加」で自分を追加することもできる。
- **タブ**: ボード(進行中の一覧・入力) / 履歴(終了・中断したボードと記録の一覧) / 成績(ニックネーム別の回数・1位・平均)。
- **アクセス制限(任意)**: ログインが無いため、`.env` の `SCOREBOARD_KEY` を設定すると API がそのキーを要求する。
  設定した場合は `https://<host>/scoreboard/?key=<値>` で一度開けば端末に記憶される。未設定なら誰でも使える。

JSON API は `/scoreboard/api` 配下(`GET /boards/active`, `POST /boards`, `POST /boards/:id/turns`,
`DELETE /boards/:id/turns/last`, `POST /boards/:id/players`, `POST /boards/:id/finish|abort`, `DELETE /boards/:id`,
`GET /boards?limit=`, `GET /players`, `GET /stats`)。データは `data/linebot.sqlite` の `board*` テーブルに入る。

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
