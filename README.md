# node_linebot

Node.js (Express) 製のLINE Bot。`@BOT`へのメンションでコマンドを認識する。
LINEから叩けるコマンドは意図的に**ダイス**と**ダイエット試算**の2つだけに絞ってあり、
それ以外の設定(メール転送・予定通知など)はサーバー側のCLIから行う。

## できること

`@BOT` にメンションすると以下のコマンドを認識する（`SELF_NAME` で変更可）。

- `nDm` - ダイスロール（例: `@BOT 2D6`)
- `diet 目標値 目標日 初期値 [開始日]` - 減量ペースの試算。結果には月間減量率に応じた
  現実性ランク(🟢〜🔴)のバッジが付き、タップすると説明ページ(`/diet-status.html`)を開ける
  (`PUBLIC_BASE_URL` 未設定時はタップ不可のバッジとして表示される)

このほか LIFF(`https://<host>/liff/`) に、ダイスとダイエット試算の入力フォーム(`/liff/`)と、
LINEログインで使う得点記録ページ **モルック**(`/liff/molkky/`)・**ゴルフ**(`/liff/golf/`)・**汎用の得点ボード**(`/liff/scoreboard/`)、
**現在時刻表示 + 共有タイマー**(`/liff/timer/`)があり、いずれもリッチメニューから開ける
(下記「得点記録ページ」「現在時刻表示 + カウントダウンタイマー」参照)。

メンションなしのメッセージ・スタンプ・画像/動画添付も含め、すべてのメッセージは会話ごとにSQLiteへログされ、
`recipient` 設定(サーバー側の `node scripts/cfg.js` で設定)があれば10分デバウンスでダイジェストメールとして転送される
(画像はメールに添付して転送され、動画などそれ以外の添付はファイル自体の保存はせず「添付が届いた」旨だけがログ・ダイジェストメールに記録される)。

`DAILY_SCHEDULE_TARGET` を設定した会話には、5日先の予定を毎日8:00 JSTに通知するバッチも(サーバー側の設定のみで)動く。

## 構成

| ディレクトリ/ファイル | 役割 |
|---|---|
| `src/index.js` | Expressサーバー本体。`/webhook` でLINEイベントを受信 |
| `src/handlers/selecter.js` | 受信イベントのディスパッチ(`dice`/`diet`のみ)、SQLiteへのログ記録 |
| `src/handlers/dice.js` / `diet.js` / `help.js` | 各コマンドの実装 |
| `src/line/*.js` | `@line/bot-sdk` を使ったLINE API呼び出し |
| `public/liff/` | ダイス/ダイエット試算のLIFPフォーム(`index.html`)と、得点記録ページ共通の `liffauth.js`(LIFFログイン)・`score.css` |
| `src/liff/auth.js` / `me.js` / `errors.js` | LIFFアクセストークンの検証(LINEログイン)、ニックネーム(`/api/me`)、API共通エラー |
| `src/molkky/` + `public/liff/molkky/` | モルック得点記録(YURU の molkky の移植)。API は `/api/molkky` |
| `src/golf/` + `public/liff/golf/` | ゴルフ得点記録(YURU の golf の移植、招待URLの参加者限定は無し)。API は `/api/golf`。`sw.js` は圏外用の Service Worker |
| `src/scoreboard/` + `public/liff/scoreboard/` | 汎用の得点ボード(ゲームを問わない加点/減点)。API は `/api/scoreboard` |
| `src/timer/` + `public/liff/timer/` | 現在時刻表示 + 共有カウントダウンタイマー。API は `/api/timer` |
| `src/google/calendar.js` | Calendar API v3。`DAILY_SCHEDULE_TARGET` の予定通知バッチが使用 |
| `src/google/mail.js` | nodemailer(SMTP)経由でのダイジェストメール送信。画像メッセージは添付ファイルとして転送 |
| `src/lib/db.js` | 会話ごとの設定(cfg)とログ(log)を保存するSQLite(`node:sqlite`)ラッパー |
| `src/lib/cache.js` | プロセス内メモリキャッシュ(node-cache)。プロセス再起動で消える |
| `src/lib/scheduler.js` | `data/triggers.json` にジョブを永続化する自前の遅延ジョブキュー(10分後のメール送信等)。再起動しても保留中のジョブは復元される |
| `src/cron/dailySchedule.js` | `DAILY_SCHEDULE_TARGET` を設定した場合のみ有効になる、5日先の予定を毎日8:00 JSTに通知するバッチ |
| `scripts/cfg.js` | サーバー(SSH)から会話ごとの設定(Calendar/メール転送設定)を確認・変更するCLI。設定用のLINEコマンドは無い |
| `scripts/liff.js` | LIFFアプリの一覧/作成/削除を行うCLI |
| `scripts/pending.js` | 送信待ちのダイジェストメール一覧を表示するCLI |
| `scripts/richmenu.js` | リッチメニューの一覧/作成/削除を行うCLI |
| `scripts/test-post.js` | HTTP層を経由せず `selecter` を直接呼び出す簡易動作確認スクリプト |

## セットアップ

### 1. Google Cloud サービスアカウントを準備する

1. GCPプロジェクトを作成し、以下のAPIを有効化する: Google Calendar API
2. サービスアカウントを作成し、JSON鍵をダウンロードする（`service-account.json`として保存し、リポジトリにはコミットしない）
3. 認証情報は `.env` の `GOOGLE_APPLICATION_CREDENTIALS` に鍵ファイルのパスを入れるか、`GOOGLE_SERVICE_ACCOUNT_KEY` にJSON全文を1行で設定する。GCE/Cloud Run等でADCが使える環境なら未設定でもよい
4. `DAILY_SCHEDULE_TARGET` の予定通知や会話ごとの `Calendar` 設定を使う場合は、対象カレンダーをその認証主体(サービスアカウント等)から参照できる状態にする

### 2. LINE Developers でチャネルを準備する

1. Messaging APIチャネルを作成し、チャネルアクセストークン・チャネルシークレットを取得する
2. Webhook URLを `https://<デプロイ先>/webhook` に設定する

### 2.5. LIFF / リッチメニューを使う場合(任意)

1. `node scripts/liff.js create https://<デプロイ先>/liff/` でLIFFアプリを作成する(エンドポイントは必ず `/liff/` で終える。
   得点記録ページは `https://liff.line.me/<liffId>/molkky/` のようにそのサブパスとして開く)
2. 作成された `liffId` を `.env` の `LIFF_ID` に設定する
3. Botを再起動する
4. `node scripts/richmenu.js create-and-set assets/richmenu.png` でリッチメニュー(3×2: サイコロ/ダイエット試算/タイマー、
   モルック/ゴルフ/得点ボード)を反映する

既に作成済みのLIFFアプリには、得点記録ページのLINEログインに必要な `profile` スコープを
`node scripts/liff.js update <liffId> https://<デプロイ先>/liff/` で付け直す。

### 3. 環境変数を設定する

`.env.example` を `.env` にコピーして値を埋める。

```
cp .env.example .env
```

### 4. メール転送用SMTP(任意)

Gmailの「アプリパスワード」等を`SMTP_USER`/`SMTP_PASS`に設定する（サービスアカウントでのGmail送信はGoogle Workspaceの
ドメイン全体委任が必要になるため、この構成ではSMTP経由の送信を採用している）。設定後、転送したい会話について
サーバー上で `node scripts/cfg.js set <sname> recipient <アドレス>` を実行すると、その会話のメッセージが
10分デバウンスでメール転送されるようになる(テキストとスタンプは本文、画像は添付ファイルとして送信。`subject`/`replyTo`/`SenderName` も任意で設定可能)。

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
（少なくとも `.env` のLINE認証情報が実際に有効である必要があり、Calendar/メール機能も使う設定ならその認証情報も必要）。

## 得点記録ページ(モルック / ゴルフ / 得点ボード)

[YURU](https://github.com/mNemu/YURU) の molkky / golf ページを移植した、スマホ入力向けの単独ページ。
LIFF のサブパスとして開く(`https://liff.line.me/<liffId>/molkky/` 等。リッチメニューにボタンがある)。

- **LINEログイン + 別途ニックネーム**: 本人は LIFF のアクセストークン(`profile` スコープ)から得た LINE userId で識別する。
  ただし表示名に LINE の名前は使わず、ページ上で別途設定するニックネーム(`/api/me`、サーバーに保存)を使う。
  未設定のうちは参加・作成ができず、各ページの上部で入力を促す。
- **モルック** (`/liff/molkky/`): 参照元と同じルール。個人戦/チーム戦、3連続ミス時「0点に戻す/失格」、
  50点ちょうどで勝ち・超えたら25点、最初の50点到達後に残りチームで2位以下を決める「続行」、1投取り消し、
  複数ゲームの同時進行、履歴、個人成績(試合/勝/勝率/投/平均/12点/0点率)。参加者名は自由入力で、本人のニックネームは自動追加される。
- **ゴルフ** (`/liff/golf/`): 参照元と同じ作りで、各自が自分の打数を「+1打」「次のホール」で入力する。
  操作は端末の localStorage に追記ログとして保存され、圏外でも入力を続けられ、電波が戻ると
  `/api/golf/rounds/:id/me/actions` にまとめて送る(サーバーは受理済みの seq を無視するので二重計上しない)。
  ハンデ(ネット＝グロス−ハンデ)、ホール別打数の補正、別端末への引き継ぎ、全員ホールアウトで自動終了、履歴、個人成績。
  終了/中断/削除はラウンドを作成した人のみ。**招待URLによる参加者限定ラウンドは実装していない**(すべて公開)。
  圏外で開き直す用の Service Worker(`/liff/golf/sw.js`)も移植したが、LINE アプリ内ブラウザ(特に iOS)では動かないため、
  ページ側で「圏外に備えるなら Chrome / Safari で開く」案内を出す(参照元と同じ)。
- **得点ボード** (`/liff/scoreboard/`): ゲームを問わない汎用版。参加者をタップして加点/減点し、合計点順に順位(同点は同順位)。
  途中参加、履歴、成績(回数/1位/平均/ベスト)。
- **複数端末で共有**: いずれも状態はサーバー(SQLite)が持ち、5秒ごとに他端末の更新を反映する。
  `#game=<id>` / `#round=<id>` / `#board=<id>` 付きのURLを送れば同じものを開ける。

JSON API は `/api/me`(ニックネーム)、`/api/molkky`、`/api/golf`、`/api/scoreboard`、`/api/timer` 配下で、
すべて `Authorization: Bearer <LIFFアクセストークン>` が必要(LINE の verify / profile API で検証し、10分キャッシュ)。
開発時は `.env` に `LIFF_DEV_AUTH=1` を入れると `Bearer dev:<userId>` を LINE に問い合わせず受け付ける(本番では絶対に有効にしない)。
データは `data/linebot.sqlite` の `liff_nickname` / `molkky_*` / `golf_*` / `board*` / `timer` テーブルに入る。

## 現在時刻表示 + カウントダウンタイマー

`/liff/timer/` は、現在時刻のライブ表示と、ログイン済みなら誰でも見える共有のカウントダウンタイマー一覧を
1画面にまとめたページ(リッチメニューの「タイマー」ボタンから開く)。

- **現在時刻表示**: ページ上部に常時表示。クライアント側で1秒ごとに再計算するだけで、サーバーとの通信は発生しない。
- **タイマーは名前を付けて複数作成でき、全員で共有**する(得点ボードと同じ「全件公開の一覧」方式。作成者以外も
  閲覧・開始/一時停止/リセット/削除ができる)。種類は2つ:
  - **日時指定(`deadline`)**: 指定した日時までの残り時間を表示するだけで、開始/一時停止の概念はない
    (目標日時が来れば自動的に「経過」表示に切り替わる)。
  - **時間指定(`duration`)**: 「10分」のように長さを指定して開始するストップウォッチ式のカウントダウンで、
    一時停止・再開・リセットができる。実行中かどうかと再開時の起点(`started_at`)はサーバー(SQLite)が保持しており、
    複数端末で同じタイマーを開いても同じ残り時間が(多少のずれはあれど)見える。
- 一覧は5秒ごとのポーリングで他ユーザーの操作を反映し、残り時間の表示自体は毎秒ローカルで再計算する
  (サーバーへの問い合わせを1秒ごとには行わない)。
- JSON API(`/api/timer`)はモルック/ゴルフ/得点ボードと同じ形で、LIFFログイン(`Authorization: Bearer`)が必須。
  データは `data/linebot.sqlite` の `timer` テーブルに永続化される。

## 運用コマンド(サーバー上のシェルから)

```
node scripts/cfg.js snames                        # 既知の会話一覧(sname + 直近の発言者名)
node scripts/cfg.js list <sname>                   # ある会話の設定を一覧表示
node scripts/cfg.js get <sname> <key>               # 設定値を1つ取得
node scripts/cfg.js set <sname> <key> <value>       # 設定値を1つ変更
node scripts/liff.js list                           # LIFFアプリ一覧
node scripts/liff.js create https://<host>/liff/    # LIFFアプリ作成
node scripts/liff.js update <liffId> https://<host>/liff/  # 既存LIFFアプリのスコープ/URLを付け直す
node scripts/liff.js delete <liffId>                # LIFFアプリ削除
node scripts/pending.js                              # 送信待ちのダイジェストメール一覧
node scripts/richmenu.js list                        # リッチメニュー一覧
node scripts/richmenu.js create-and-set assets/richmenu.png  # デフォルトのリッチメニューを作成して反映
node scripts/richmenu.js delete <richMenuId>         # リッチメニュー削除
```

対応キー: `Calendar`, `recipient`, `subject`, `replyTo`, `SenderName`

## 注意事項

- `data/` ディレクトリは会話ごとの設定/ログ(`linebot.sqlite`)と保留中のメール送信ジョブ(`triggers.json`)の
  永続化に使うため、デプロイ先でも書き込み可能な永続ボリュームにすること
  （コンテナ環境で揮発するディスクの場合、再起動時にデータが消える）。
- キャッシュ (`src/lib/cache.js`) はプロセス内メモリのみで、複数インスタンス間や再起動をまたいで共有されない。
  複数インスタンスでスケールする場合はRedis等への置き換えを検討すること。
