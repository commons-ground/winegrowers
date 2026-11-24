"""ワイン生産者向けの許可リストを作る（ground の core:web-access への上乗せ）。
出力：claude-code-settings.json と sites.txt（このフォルダ）。
入れる基準は ground の web-access と同じ：読むだけで、利用者が書き込めない公的・学術・業界団体のサイト。
政府・自治体・大学・国際機関（*.go.jp、*.ac.jp、*.int など）は ground のリストに入っているので、ここには入れない。"""
import json, pathlib

SITES = [
    # 品種・遺伝資源のデータベースと、それを運営する公的研究機関
    ("vivc.de", "VIVC（ブドウ品種の国際カタログ）。ドイツ連邦の研究機関 JKI が運営"),
    ("julius-kuehn.de", "JKI（ドイツ連邦の栽培植物研究所）。ブドウ育種研究所の資料"),
    ("openagrar.de", "ドイツ連邦農業省所管の研究機関の論文置き場。学術誌 VITIS の論文"),
    ("inrae.fr", "INRAE（フランス国立農業・食料・環境研究所）"),
    ("hs-geisenheim.de", "ガイゼンハイム大学（ドイツのワイン・栽培の大学）"),
    ("awri.com.au", "AWRI（オーストラリアワイン研究所）"),
    # 学術誌（読むだけ）
    ("oeno-one.eu", "OENO One（栽培・醸造の学術誌。IVES が発行）"),
    ("ives-openscience.eu", "IVES（OENO One などを出す非営利の学会）"),
    ("ajevonline.org", "AJEV（米国ブドウ栽培醸造学会の学術誌）"),
    # 国内の業界団体
    ("winery.or.jp", "日本ワイナリー協会"),
]

hosts = []
for h, _ in SITES:
    hosts += [h, "*." + h]
here = pathlib.Path(__file__).parent
(here / "claude-code-settings.json").write_text(
    json.dumps({"permissions": {"allow": [f"WebFetch(domain:{h})" for h in hosts]}}, ensure_ascii=False, indent=2) + "\n")
(here / "sites.txt").write_text("\n".join(hosts) + "\n")
print(len(hosts))
