# winegrowers

ワイン生産者のコモンズです。土台の [commons-ground/ground](https://github.com/commons-ground/ground)（業種を問わない基本ルール・調べもの・労務・経営など）の上に、ワイン生産者に共通のものを足します。参加する各社は、ground とここの両方を取り込み、自分だけのことは自分の Notion のスキルDBに置きます。

| 置き場 | 中身 |
| --- | --- |
| `plugins/grape` | 畑・栽培：防除の計画と記録の点検、ビンテージの気象と総評、地形と冷気の流れ |
| `plugins/bottle` | 瓶詰め後・販売：ワインの写真から、畑・年の天候・醸造・等級・造り手を生産者の目で読み解く |
| `servers/commons-mcp` | 知識コモンズ（Notion）への入口。参加者の Claude から知識コモンズを読み書きする。くわしくは [知識コモンズ](docs/knowledge-commons.md) |

はじめての人は [入口のページ](https://commons-ground.github.io/ground/) から。

コモンズ全体の仕組み（土台のコモンズと個別のコモンズ、使い方、直し方）は ground の [コモンズのしくみ](https://github.com/commons-ground/ground/blob/main/docs/how-commons-work.md) にあります。プラグインと表の設計図は [docs/plugins-and-schemas.md](docs/plugins-and-schemas.md)。

## 入れ方

Claude（アプリ）では、カスタマイズ → プラグイン → マーケットプレイスを追加 で `commons-ground/ground` と `commons-ground/winegrowers` の2つを足し、使うプラグインを入れます。

Claude Code では次のとおりです。

```
/plugin install core --marketplace commons-ground/ground
/plugin install grape --marketplace commons-ground/winegrowers
/plugin install bottle --marketplace commons-ground/winegrowers
```

## 直し方

作業のルールは `CLAUDE.md` にあります。土台（ground）の基本ルールはここでも効きます。

## 話す場所

参加者どうしは Discord で話します。決まったこと・残す知識は Discord に置きっぱなしにせず、知識コモンズかこのリポジトリに移します。

Discord の `#aiに聞く` などで `/ai 〇〇` と打つと、このリポジトリと ground のスキルを読んだ「コモンズのAI」が答えます。呼び名やふるまいは `discord/` に、仕組みは ground の [discord-ai-member](https://github.com/commons-ground/ground/tree/main/tools/discord-ai-member) にあります。
