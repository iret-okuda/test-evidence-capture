# Test Evidence Capture

WebアプリのDOM要素を選び、選択範囲をPNGで保存するChrome拡張です。範囲をドラッグで調整せず、テスト番号・区分・赤枠注釈を付けた証跡を少ない操作で作成できます。

## 主な機能

- ツールバーアイコンまたはショートカットから撮影モードを開始
- 右クリックまたは`Space`で単一選択、`Shift`を加えて複数選択・解除
- 全選択DOMの外接矩形を8 CSS pxの余白付きでcrop
- 選択したDOMだけ、保存PNGへ赤枠を描画
- 表示中のTooltipを撮影範囲へ自動追加
- 必要な場合だけviewport外を自動スクロールし、複数画像を1枚へ結合
- `AC-1-1-1-before.png`形式のファイル名を自動生成
- 保存先、入力設定、直近5件のDOM選択を保持
- 撮影モード中もページ本来の左クリック操作を維持

## インストール

1. Chromeで `chrome://extensions` を開きます。
2. 「デベロッパー モード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」から、このディレクトリを選択します。
4. 拡張機能メニューで `Test Evidence Capture` をピン留めします。

ローカルHTMLで使う場合は、拡張機能の詳細画面で「ファイルのURLへのアクセスを許可する」を有効にしてください。

初期ショートカットはmacOSが `Command + Shift + S`、その他が `Ctrl + Shift + S` です。競合する場合は `chrome://extensions/shortcuts` で変更できます。

## 基本操作

1. 証跡を取得するタブで、ツールバーのアイコンをクリックします。
2. 右上のパネルでprefix、番号、`before` / `after` / `result`を設定します。
3. 対象DOMを右クリックまたは`Space`で選択します。追加・解除は`Shift + 右クリック`または`Shift + Space`です。
4. 必要に応じて「選択中のDOM」を開き、PNGへ赤枠を付けるDOMをチェックします。
5. 「撮影する (Enter)」または`Enter`で保存します。
6. 終了するときは`Escape`を押します。

保存後も撮影モードと選択状態は維持されます。同じDOMを再利用する場合は「直近のDOM選択」から復元し、対象を確認してから撮影してください。

### 選択を調整する

| 操作 | 動作 |
| --- | --- |
| 右クリック / `Space` | 1要素だけを選択 |
| `Shift + 右クリック` / `Shift + Space` | 選択へ追加、または解除 |
| `ArrowUp` | ホバー対象の親要素へ移動 |
| `ArrowDown` | 直前にたどった子要素へ戻る |
| `Enter` | PNGを保存 |
| `Escape` | 撮影モードを終了 |

オレンジ枠はホバー対象、青枠は選択対象、緑の破線は保存範囲、紫の破線は自動検出したTooltipを表します。これらの補助UIはPNGへ写りません。

### ファイル名

初期設定では `AC-1-1-1-before.png` です。№（2）・№（3）と区分は個別に省略できます。

| 設定 | ファイル名 |
| --- | --- |
| 初期設定 | `AC-1-1-1-before.png` |
| №（3）をOFF | `AC-1-1-before.png` |
| №（2）をOFF | `AC-1-before.png` |
| 区分をOFF | `AC-1-1-1.png` |

№（2）をOFFにすると№（3）もOFFになります。同名ファイルは ` (1)`、` (2)` のように連番を付け、上書きしません。

### 保存先と設定

保存先を指定しない場合は、Chrome既定のダウンロード先へ保存します。「変更…」で選んだディレクトリはページoriginごとに記憶され、必要な場合だけ「再許可…」が表示されます。

prefix、番号、番号のON/OFF、区分、Tooltip、自動スクロールの設定は次回起動時も復元されます。「入力設定をクリア…」は入力項目だけを初期化し、保存先とDOM選択履歴は残します。

### Tooltipを含める

「表示中のTooltipを含める」は初期ONです。Tooltipを表示した状態で起点DOMを選択すると、次を撮影範囲へ追加します。

- `[role="tooltip"]`
- `.tooltip-content`
- `.tooltip[data-tip]`の`::before`本文と`::after`矢印

ホバー中だけ表示されるTooltipは、自動スクロールで消える場合があります。1画面内での撮影を推奨します。

### viewport外を撮影する

「viewport外も自動スクロール撮影」は初期OFFです。OFFでは現在のviewportだけを1回撮影し、完全に画面外の選択DOMがある場合は保存を中止します。

ONではページ本体を縦横に移動して分割撮影し、1枚のPNGへ結合した後、成功・失敗にかかわらず元のスクロール位置へ戻します。撮影中は対象タブを表示したままにしてください。

## 状態の保持

- 同じURLを再読み込みすると撮影モードを自動復元します。選択DOMは復元しません。
- `Escape`で終了した場合、別URLへ移動した場合、タブを閉じた場合は自動復元しません。
- DOM選択履歴は全体で直近5件を保持し、同じoriginとpathnameのページだけに表示します。
- 履歴からは青枠・赤枠・DOM一覧を復元します。対象DOMを解決できない場合、古い座標では代用しません。

## 既知の制限

- iframe内部とShadow DOM内部の要素は選択できません。iframe自体は選択できます。
- 独立したスクロールコンテナの非表示部分は自動スクロールしません。
- 自動スクロール時のlazy loadやレイアウト変更は、結合位置をずらす可能性があります。
- fixed/sticky要素は分割画像ごとに写るため、結合結果で重複する場合があります。
- 1回の撮影上限は100画面、Canvas一辺32,767px、合計1億pixelです。
- `pointer-events: none`の補完選択は、`:disabled`または`aria-disabled="true"`の要素だけが対象です。
- Tooltipの独自クラス、Shadow DOM内のTooltip、動画、OCR、文字・矢印・自由描画注釈には対応していません。
- Chrome内部ページやChrome Web Storeなど、content scriptを実行できないページでは利用できません。
- ブラウザズーム100%を基本条件としています。他の倍率にも実画像倍率から追従しますが、手動確認の対象です。
- File System Access APIを利用できない環境では、保存時に「名前を付けて保存」ダイアログを表示します。

## 実装概要

| ファイル | 責務 |
| --- | --- |
| `manifest.json` | Manifest V3設定、権限、アクション、ショートカット |
| `background.js` | モード開始、`captureVisibleTab()`、PNGダウンロード |
| `content.js` | 撮影UI、DOM選択、分割撮影、Canvas crop・結合 |
| `bounds.js` | 外接矩形、clamp、画像倍率、スクロール位置の計算 |
| `annotations.js` | 赤枠の余白、clamp、crop座標への変換 |
| `filename.js` | 入力の正規化とファイル名生成 |
| `storage.js` | IndexedDBによる保存先保持とPNG書き込み |
| `history.js` | DOMロケーター履歴の検証と最大5件の制御 |

座標はdocument上のCSS pixelで管理し、Chromeが返した画像からX/Yの倍率を個別に算出します。撮影直前に拡張UIを隠して描画フレームを待ち、crop後のCanvasへチェック済みDOMの赤枠だけを描画します。

オーバーレイはclosed Shadow DOM内に配置します。右クリック系イベントだけをcapture phaseで抑止し、通常の左クリックはページへ通します。設定と履歴は `chrome.storage.local`、同一URLのモード復元状態は `chrome.storage.session`、保存先のディレクトリハンドルはIndexedDBへ保存します。

## ローカル検証

```bash
node tests/bounds.test.js
node tests/annotations.test.js
node tests/filename.test.js
node tests/storage.test.js
node tests/history.test.js
```

Node.jsテストでは、座標・倍率・注釈・ファイル名・保存先・履歴のロジックを確認します。実ChromeでのUI操作、Retina表示、PNG保存、自動スクロール結合は別途手動確認が必要です。
