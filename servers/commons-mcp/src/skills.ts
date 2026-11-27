// Skills over MCP（MCP の Skills 拡張、io.modelcontextprotocol/skills）で、コモンズの共有スキルをコネクタから配る。
// - 正本は GitHub のプラグインのまま。配るスキルは skills.json で選び、置き直しのときに gen-skills.mjs が Worker に詰める
// - 配る版は置き直した時点のコミットで固定される（中身のダイジェストも決まる）。Claude 側は、中身が変わると承認を取り直す
// - URI は skill://<コモンズ>/<スキル名>/SKILL.md（例：skill://ground/knowledge-qa/SKILL.md）
import { SkillsExtension, memorySkillFiles, type SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import { SKILL_FILES_B64 } from "./skills.gen";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

let catalog: Promise<SkillCatalog | undefined> | undefined;

// 1つの Worker の中で1回だけ組み立て、リクエストごとのサーバーに付け回す。組み立てに失敗したらスキルは出さず、道具はそのまま動かす
export function skillCatalog(): Promise<SkillCatalog | undefined> {
  catalog ??= (async () => {
    const entries = Object.entries(SKILL_FILES_B64);
    if (!entries.length) return undefined;
    const files = Object.fromEntries(entries.map(([path, b64]) => [path, decode(b64)]));
    return SkillsExtension.load(memorySkillFiles(files), {
      cacheHint: { ttlMs: 5 * 60 * 1000, cacheScope: "public" },
      onWarning: (w) => console.warn(`skills: ${w.path}: ${w.message}`),
    });
  })().catch((e) => {
    console.error("skills: 組み立てられませんでした", e);
    return undefined;
  });
  return catalog;
}
