// skills.json に書いたスキルを GitHub の正本から読み、Worker に詰める src/skills.gen.ts を作る。
// wrangler の build（wrangler.jsonc）から、置き直し・dev のたびに自動で走る。生成物はリポジトリに入れない（.gitignore）。
// - ground：一時フォルダに浅く clone して、skills.json の ref の版を読む
// - winegrowers：このリポジトリ自身（../../）を読む
// 配った版を後から追えるよう、両方のコミットを生成物に書く。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, "..");
const config = JSON.parse(readFileSync(join(server, "skills.json"), "utf8"));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

const files = {}; // "<コモンズ>/<スキル名>/<ファイル>" → 中身（base64。画像などのバイナリも同じ形で運ぶ）
const sources = {};

function take(root, repo, skillDirs) {
  for (const rel of skillDirs ?? []) {
    const dir = join(root, rel);
    const name = rel.split("/").pop();
    const skillMd = join(dir, "SKILL.md");
    if (!statSync(skillMd, { throwIfNoEntry: false })) throw new Error(`${repo}/${rel} に SKILL.md がありません`);
    for (const f of walk(dir)) files[`${repo}/${name}/${relative(dir, f).split("\\").join("/")}`] = readFileSync(f).toString("base64");
  }
}

const groundSkills = config.ground?.skills ?? [];
if (groundSkills.length) {
  const ref = config.ground.ref || "main";
  const dir = process.env.GROUND_DIR || mkdtempSync(join(tmpdir(), "ground-"));
  if (!process.env.GROUND_DIR) git(tmpdir(), "clone", "-q", "--depth", "1", "--branch", ref, "https://github.com/commons-ground/ground", dir);
  sources.ground = git(dir, "rev-parse", "HEAD");
  take(dir, "ground", groundSkills);
}
const wgSkills = config.winegrowers?.skills ?? [];
const wgRoot = join(server, "..", "..");
try { sources.winegrowers = git(wgRoot, "rev-parse", "HEAD"); } catch {}
take(wgRoot, "winegrowers", wgSkills);

writeFileSync(
  join(server, "src", "skills.gen.ts"),
  `// gen-skills.mjs が作る。手で直さない（直すのは GitHub のスキルの正本と skills.json）\n` +
    `export const SKILL_SOURCES: Record<string, string> = ${JSON.stringify(sources)};\n` +
    `export const SKILL_FILES_B64: Record<string, string> = ${JSON.stringify(files, null, 0)};\n`,
);
console.log(`スキルを詰めました：${Object.keys(files).length} ファイル（${JSON.stringify(sources)}）`);
