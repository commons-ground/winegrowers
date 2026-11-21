# プラグインとDBの設計図（ワイン生産者）

ワイン生産者のコモンズのプラグインと、それぞれが使う表（DB）の設計図。業種を問わないもの（基盤・労務・経営・補助金など）と、共通の台帳（拠点・圃場・人・資材など）は、土台の ground の [プラグインとDBの設計図](https://github.com/commons-ground/ground/blob/main/docs/plugins-and-schemas.md) にある。いまは grape と、bottle の一部（ワインの深掘り）が入っている（tank はまだ）。

## 1. プラグインごとの中身

つくる〜売るの流れで分け、前の段の記録を次の段が読む。

| まとまり | プラグイン | 主なスキル | 共有する知識・DBの設計図 | 要る人 |
| --- | --- | --- | --- | --- |
| ワインの流れ | grape 畑・栽培 | 圃場と植栽、作業・観察記録、防除（防除歴・使用基準の確認）、土壌・施肥、生育・気象（積算温度・病害予測）、果汁分析・収穫判断 | 圃場・植栽・作業記録・防除歴・土壌分析・果汁分析 | ほぼ全員 |
| ワインの流れ | tank 醸造 | 仕込み・発酵管理、醸造分析、醸造資材、瓶詰め、委託醸造先とのやりとり、酒税（製造・移出の帳簿、申告、製造免許の届出） | ロット・タンク・分析 | 自社醸造・委託醸造 |
| ワインの流れ | bottle 瓶詰め後・販売 | 他の造り手のワインの深掘り（写真から畑・年・醸造・等級を読み解く）、商品情報（テクニカルシート・紹介文・テイスティング）、ラベル表示、在庫・出荷、酒類販売業としての帳簿・届出（小売・卸）、取引先・顧客、イベント出店、SNS・Web | ワイン一覧・取引先 | ワインを売る人 |

- **酒税は tank、酒類販売業の手続きは bottle**：製造者としての酒税は醸造側。小売・卸として売る側の帳簿・届出とラベル表示は販売側。免許の無い生産者は、🧭 AI設定ページで「対象外」にすれば関連スキルが動かない

## 2. DBの設計図

各分野の記録は、ground の core にある共通の台帳を参照する。防除歴も収穫も「圃場」を参照するので、分野をまたいで足し合わせられる。栽培・醸造の記録の元は、将来は栽培管理のアプリにする。

| 分野 | DB（論理名） |
| --- | --- |
| grape | 植栽 `plantings`、作業記録 `work_logs`、観察 `observations`、防除歴 `spray_records`、土壌分析 `soil_analysis`、施肥 `fertilization`、果汁分析 `berry_samples`、収穫 `harvests`、ビンテージ `vintages` |
| tank | ロット `lots`、タンク・樽 `vessels`、セラー作業 `cellar_ops`、ワイン分析 `wine_analysis`、瓶詰め `bottlings`、委託醸造 `contract_production`、製造・移出の帳簿 `tax_ledger`、酒税申告 `tax_returns`、届出 `notices` |
| bottle | 深掘りの記録 `wine_dossiers`、商品 `products`、在庫 `inventory`、受注・出荷 `orders`、出店 `booths`、ラベル表示 `labels`、酒類販売の帳簿 `retail_ledger`、販売業の届出 `retail_reports` |

## 3. 本家のスキルへの上乗せ

| コモンズのスキル | 本家 | ライセンス | 上乗せの中身 |
| --- | --- | --- | --- |
| grape の spray-plan | `human-avatar/skills-for-agriculture` の `s4ag-pests` | MIT | 農薬取締法の使用基準、FRAC/IRACのローテーション、日本のワイン用ブドウの病害、醸造への影響、防除歴の点検 |
| grape の terrain-reading | `human-avatar/skills-for-agriculture` の `s4ag-land-reading` | MIT | 国土地理院の標高データと航空写真での計算（傾斜・向き・周りとの高さ・窪地・冷気の流れ）、ワイン用ブドウの判断の目安、気温での確かめ方 |
