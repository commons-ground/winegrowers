# winegrowers

ワイン生産者のコモンズです。土台の [commons-ground/ground](https://github.com/commons-ground/ground)（業種を問わない基本ルール・調べもの・労務・経営など）の上に、ワイン生産者に共通のものを足します。各社（モゥ、Fusa ヴィンヤードなど）は、ground とここの両方を取り込み、自分だけのことは自分の Notion のスキルDBに置きます。

| 置き場 | 中身 |
| --- | --- |
| `plugins/grape` | 畑・栽培：防除の計画と記録の点検、ビンテージの気象と総評、地形と冷気の流れ |
| `servers/commons-mcp` | 知識コモンズ（Notion）への入口。参加者の Claude から知識コモンズを読み書きする |

## 入れ方

Claude（アプリ）では、カスタマイズ → プラグイン → マーケットプレイスを追加 で `commons-ground/ground` と `commons-ground/winegrowers` の2つを足し、使うプラグインを入れます。

Claude Code では次のとおりです。

```
/plugin install core --marketplace commons-ground/ground
/plugin install grape --marketplace commons-ground/winegrowers
```

## 直し方

作業のルールは `CLAUDE.md` にあります。土台（ground）の基本ルールはここでも効きます。
