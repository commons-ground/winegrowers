// コモンズの Discord を、参加者の Claude から読み書きする道具。
// ボット「コモンズのAI」の鍵（DISCORD_BOT_TOKEN）で読み書きする。鍵は Worker の secret にだけ置く。
// 読めるのは DISCORD_GUILD_ID のサーバーだけ。ほかのサーバーのチャンネルIDを渡されても断る。

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const API = "https://discord.com/api/v10";
const MAX_LEN = 1900; // 1メッセージ2000字まで。署名の分を空ける

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): Text => ({ content: [{ type: "text", text }] });
const fail = (msg: string): Text => ({ content: [{ type: "text", text: `エラー: ${msg}` }], isError: true });

class DiscordError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function discord(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new DiscordError(res.status, `${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const explain = (e: unknown): Text => {
  if (e instanceof DiscordError && (e.status === 403 || e.status === 404)) {
    return fail("そのチャンネルは見られません。チャンネルIDが違うか、ボットに見る権限がありません。");
  }
  return fail(e instanceof Error ? e.message : String(e));
};

type Channel = { id: string; name: string; type: number; parent_id?: string; topic?: string };
const TEXT_TYPES = new Set([0, 5, 15]); // テキスト・お知らせ・フォーラム

export function registerDiscordTools(server: McpServer, token: string, guildId: string, author: string): void {
  // チャンネルがこのサーバーのものかを確かめる（スレッドも含む）
  const ownChannel = async (channelId: string): Promise<Channel> => {
    const ch = await discord(token, "GET", `/channels/${channelId}`);
    if (ch.guild_id !== guildId) throw new DiscordError(403, "other guild");
    return ch;
  };
  // チャンネル名（#aiに聞く など）でも ID でも受け付ける
  const resolve = async (channel: string): Promise<Channel> => {
    const c = channel.trim().replace(/^#/, "");
    if (/^\d{15,22}$/.test(c)) return ownChannel(c);
    const list: Channel[] = await discord(token, "GET", `/guilds/${guildId}/channels`);
    const hit = list.find((x) => x.name === c && TEXT_TYPES.has(x.type));
    if (!hit) throw new Error(`チャンネル「${c}」が見つかりません。discord_channels で名前を確かめてください。`);
    return hit;
  };

  server.registerTool(
    "discord_channels",
    {
      title: "Discord のチャンネル一覧",
      description: "コモンズの Discord のテキストチャンネルと、進行中のスレッドを一覧にする。",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const list: Channel[] = await discord(token, "GET", `/guilds/${guildId}/channels`);
        const threads = (await discord(token, "GET", `/guilds/${guildId}/threads/active`)).threads as Channel[];
        const lines = list
          .filter((c) => TEXT_TYPES.has(c.type))
          .map((c) => `- #${c.name}  id: ${c.id}${c.topic ? `  （${c.topic}）` : ""}`);
        const tl = threads.map((t) => `- スレッド「${t.name}」  id: ${t.id}  親: ${t.parent_id}`);
        return ok([...lines, ...(tl.length ? ["", "進行中のスレッド", ...tl] : [])].join("\n") || "チャンネルがありません。");
      } catch (e) {
        return explain(e);
      }
    },
  );

  server.registerTool(
    "discord_read",
    {
      title: "Discord を読む",
      description:
        "コモンズの Discord のチャンネル（またはスレッド）の発言を、古い順に読む。channel は名前（例：一般）かID。" +
        "pinned_only を true にすると、📌 のリアクションが付いた発言（残したい・決まったこと）だけを返す。",
      inputSchema: z.object({
        channel: z.string().describe("チャンネル名（# なしでよい）かチャンネルID"),
        limit: z.number().int().min(1).max(100).default(30),
        before: z.string().optional().describe("この発言IDより前を読む（さかのぼるとき）"),
        pinned_only: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ channel, limit, before, pinned_only }) => {
      try {
        const ch = await resolve(channel);
        const q = new URLSearchParams({ limit: String(limit) });
        if (before) q.set("before", before);
        let msgs: any[] = await discord(token, "GET", `/channels/${ch.id}/messages?${q}`);
        if (pinned_only) msgs = msgs.filter((m) => (m.reactions || []).some((r: any) => r.emoji?.name === "📌"));
        if (!msgs.length) return ok(pinned_only ? "📌 の付いた発言はありません。" : "発言はありません。");
        const lines = msgs.reverse().map((m) => {
          const who = m.member?.nick || m.author?.global_name || m.author?.username || "?";
          const when = new Date(m.timestamp).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
          const reacts = (m.reactions || []).map((r: any) => `${r.emoji?.name}${r.count}`).join(" ");
          const files = (m.attachments || []).map((a: any) => `［添付: ${a.filename}］`).join(" ");
          const thread = m.thread ? `［スレッド「${m.thread.name}」id: ${m.thread.id}］` : "";
          return `[${when}] ${who}${m.author?.bot ? "（ボット）" : ""}：${m.content || ""} ${files}${thread}${reacts ? `  (${reacts})` : ""}  id: ${m.id}`;
        });
        return ok(`#${ch.name} の発言（古い順）\n` + lines.join("\n"));
      } catch (e) {
        return explain(e);
      }
    },
  );

  server.registerTool(
    "discord_post",
    {
      title: "Discord に書く",
      description:
        "コモンズの Discord のチャンネル（またはスレッド）に書き込む。ボット「コモンズのAI」の名前で投稿され、末尾に頼んだ人の名前が付く。" +
        "reply_to に発言IDを渡すと、その発言への返信になる。@everyone などで人を呼び出すことはできない。" +
        "ここは複数の事業者が集まる場所なので、事業データ（人名・金額・口座・住所・取引先）は書かない。",
      inputSchema: z.object({
        channel: z.string().describe("チャンネル名（# なしでよい）かチャンネル・スレッドのID"),
        text: z.string().min(1).max(4000),
        reply_to: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ channel, text, reply_to }) => {
      try {
        const ch = await resolve(channel);
        const signed = `${text}\n-# ${author}（Claude 経由）`;
        const chunks: string[] = [];
        for (let i = 0; i < signed.length; i += MAX_LEN) chunks.push(signed.slice(i, i + MAX_LEN));
        let first: any;
        for (const [i, c] of chunks.entries()) {
          const m = await discord(token, "POST", `/channels/${ch.id}/messages`, {
            content: c,
            allowed_mentions: { parse: [] },
            ...(i === 0 && reply_to ? { message_reference: { message_id: reply_to, fail_if_not_exists: false } } : {}),
          });
          first ??= m;
        }
        return ok(`#${ch.name} に書きました。https://discord.com/channels/${guildId}/${ch.id}/${first.id}`);
      } catch (e) {
        return explain(e);
      }
    },
  );
}
