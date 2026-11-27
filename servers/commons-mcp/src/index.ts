// Winegrowers Commons の共有 Notion に、参加者の Claude からつなぐための MCP サーバー。
// - 認証：OAuth（claude.ai のカスタムコネクタが求める形）。本人確認は2通り。
//   1. Discord でログイン：コモンズの Discord サーバーのコモンズメンバーなら通す（ロールがまだ無ければ、入っている人なら誰でも）
//   2. 参加者コード：Discord を使わない人向け。コード → 名前の対応は Worker の secret（MEMBER_CODES）にだけ置く
// - Notion へは内部インテグレーションのトークン（NOTION_TOKEN）で読み書きする。
// - Discord へはボットの鍵（DISCORD_BOT_TOKEN）で読み書きする。鍵が無いあいだは Discord の道具を出さない。

import { AuthorizationError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { buildServer } from "./tools";
import { skillCatalog } from "./skills";

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: any;
  NOTION_TOKEN: string;
  MEMBER_CODES: string; // JSON: {"参加者コード": "表示名"}
  PUBLIC_URL?: string;
  DISCORD_BOT_TOKEN?: string; // ボット「コモンズのAI」の鍵（secret）
  DISCORD_GUILD_ID?: string; // コモンズの Discord サーバーのID（変数）
  DISCORD_CHANNELS?: string; // 読み書きを許すチャンネル名のカンマ区切り（変数）。無ければサーバー内の全テキストチャンネル
  DISCORD_CLIENT_ID?: string; // Discord アプリの ID（変数）。Discord でログインに使う
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_MEMBER_ROLE?: string; // （任意）「コモンズメンバー」ロールの名前（変数、wrangler.jsonc）。そのロールがサーバーにあれば、持つ人だけがつなげる（入っただけの見学者は Discord の /ai まで）。ロールがまだ無ければ誰でもつなげる
  DISCORD_AI_ROLES?: string; // JSON {"Discord のユーザーID": "その人の AI 用ロールの ID"}（変数）。受け取り箱で使う // Discord アプリの OAuth2 のシークレット（secret）。無いあいだは Discord でログインを出さない
}

const discordLoginReady = (env: Env) => Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_GUILD_ID);

type Props = { name: string; discordId?: string };

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// MEMBER_CODES の値は「名前」か {"name":"名前","discord":"Discord のユーザーID"}。ID があれば受け取り箱が使える
type Member = { name: string; discordId?: string };
function members(env: Env): Record<string, string | { name: string; discord?: string }> {
  try {
    return JSON.parse(env.MEMBER_CODES || "{}");
  } catch {
    return {};
  }
}

async function codeMatches(input: string, env: Env): Promise<(Member & { id: string }) | null> {
  const enc = new TextEncoder();
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  const a = await digest(input.trim());
  for (const [code, v] of Object.entries(members(env))) {
    const name = typeof v === "string" ? v : v.name;
    const discordId = typeof v === "string" ? undefined : v.discord;
    const b = await digest(code);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff === 0) return { name, discordId, id: `m-${[...b.slice(0, 6)].map((x) => x.toString(16).padStart(2, "0")).join("")}` };
  }
  return null;
}

function page(body: string, status = 200, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Winegrowers Commons</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.7;color:#222}
input[type=text],input[type=password]{width:100%;padding:.6rem;font-size:1rem;box-sizing:border-box}
button{padding:.6rem 1.2rem;font-size:1rem;margin-right:.5rem}.muted{color:#666;font-size:.9rem}.err{color:#b00}</style>
${body}</html>`,
    { status, headers: h },
  );
}

function consentForm(clientName: string, redirectHost: string, handle: string, discord: boolean): string {
  const h = escape(handle);
  const discordPart = discord
    ? `<form method="post"><input type="hidden" name="handle" value="${h}">
<p><button name="decision" value="discord"><strong>Discord でログインしてつなぐ</strong></button></p>
<p class="muted">コモンズの Discord サーバーに入っている人は、こちらだけで終わります。書き込みには Discord の表示名が付きます。</p></form>
<details><summary>Discord を使わない人（参加者コード）</summary>`
    : "";
  return `<h1>Winegrowers Commons につなぐ</h1>
<p><strong>${escape(clientName)}</strong> が、コモンズの共有 Notion と Discord を読み書きできるようになります。</p>
<p class="muted">つないだ後の行き先：${escape(redirectHost)}</p>
${discordPart}
<form method="post">
<input type="hidden" name="handle" value="${h}">
<p><label>参加者コード<br><input type="password" name="code" autocomplete="off"></label></p>
<p><button name="decision" value="approve">コードでつなぐ</button><button name="decision" value="deny">やめる</button></p>
</form>
<p class="muted">参加者コードは、コモンズの世話役から受け取ったものです。書き込んだ内容には、このコードに対応するお名前が付きます。</p>
${discord ? "</details>" : ""}`;
}

// 「コモンズメンバー」ロールの ID を名前で探す（リポジトリに ID を書かないため）。見つからなければ "" ＝絞らない
async function memberRoleId(env: Env): Promise<string> {
  if (!env.DISCORD_MEMBER_ROLE || !env.DISCORD_BOT_TOKEN) return "";
  const res = await fetch(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/roles`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return "";
  const roles = (await res.json()) as { id: string; name: string }[];
  return roles.find((r) => r.name === env.DISCORD_MEMBER_ROLE)?.id ?? "";
}

// Discord でログイン：コモンズのサーバーのメンバーかを Discord に聞き、表示名を返す
async function discordMember(code: string, redirectUri: string, env: Env): Promise<{ id: string; name: string; discordId: string } | "no-role" | null> {
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.DISCORD_CLIENT_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Discord のトークン交換に失敗しました（${tokenRes.status}）`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const res = await fetch(`https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (res.status === 404 || res.status === 403) return null; // サーバーに入っていない
  if (!res.ok) throw new Error(`Discord にメンバーかどうかを聞けませんでした（${res.status}）`);
  const m = (await res.json()) as { nick?: string; roles?: string[]; user: { id: string; username: string; global_name?: string } };
  const roleId = await memberRoleId(env);
  if (roleId && !(m.roles ?? []).includes(roleId)) return "no-role";
  return { id: `d-${m.user.id}`, name: m.nick || m.user.global_name || m.user.username, discordId: m.user.id };
}

const authHandler = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return page(`<h1>Winegrowers Commons MCP</h1><p>Claude のカスタムコネクタに <code>${escape(url.origin)}/mcp</code> を追加してください。</p>`);
    }
    const oauth = env.OAUTH_PROVIDER;
    if (url.pathname === "/discord/callback") {
      try {
        const resumed = await oauth.finishUpstream(req);
        const code = url.searchParams.get("code");
        if (!code) return page(`<h1>つなげませんでした</h1><p>Discord でログインが取り消されました。Claude の画面から、もう一度つないでください。</p>`, 400);
        const member = await discordMember(code, `${url.origin}/discord/callback`, env);
        if (!member) {
          return page(`<h1>まだ Discord のサーバーに入っていません</h1><p>コモンズの Discord サーバーの招待を受けて入ってから、Claude の画面でもう一度「接続」を押してください。</p>`, 403);
        }
        if (member === "no-role") {
          return page(`<h1>まだ「コモンズメンバー」になっていません</h1><p>Discord のサーバーには入れています（いまは見学者）。共有の Notion を使えるのはコモンズメンバーです。Discord の #ようこそ で「メンバーになりたい」と書き、メンバーの誰かに承認してもらってから、Claude の画面でもう一度「接続」を押してください（それまでも Discord の <code>/ai</code> は使えます）。</p>`, 403);
        }
        const { redirectTo } = await oauth.completeAuthorization({
          request: resumed.request,
          userId: member.id,
          metadata: { name: member.name },
          scope: resumed.request.scope,
          props: { name: member.name, discordId: member.discordId } satisfies Props,
        });
        resumed.headers.set("Location", redirectTo);
        return new Response(null, { status: 302, headers: resumed.headers });
      } catch (e) {
        const msg = e instanceof AuthorizationError ? ((e as any).description ?? "") : e instanceof Error ? e.message : String(e);
        return page(`<h1>つなげませんでした</h1><p>${escape(msg)}</p><p>Claude の画面から、もう一度つないでください。</p>`, 400);
      }
    }
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });

    try {
      if (req.method === "GET") {
        const request = await oauth.parseAuthRequest(req);
        const details = await oauth.describeConsent(request);
        const consent = await oauth.beginConsent(request);
        return page(consentForm(details.clientName, details.redirectHost, consent.handle, discordLoginReady(env)), 200, consent.headers);
      }
      if (req.method === "POST") {
        const form = await req.formData();
        const handle = String(form.get("handle") ?? "");
        if (form.get("decision") === "discord" && discordLoginReady(env)) {
          const approved = await oauth.approveConsent(req, handle);
          const up = await oauth.beginUpstream(approved.request, { headers: approved.headers });
          const q = new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID!,
            redirect_uri: `${url.origin}/discord/callback`,
            response_type: "code",
            scope: "identify guilds.members.read",
            state: up.state,
          });
          up.headers.set("Location", `https://discord.com/oauth2/authorize?${q}`);
          return new Response(null, { status: 302, headers: up.headers });
        }
        if (form.get("decision") !== "approve") {
          const denied = await oauth.denyConsent(req, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        const member = await codeMatches(String(form.get("code") ?? ""), env);
        if (!member) {
          // コードが違うときは手続きを最初からやり直してもらう（handle は1回きり）
          const denied = await oauth.denyConsent(req, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        const approved = await oauth.approveConsent(req, handle, {});
        const { redirectTo } = await oauth.completeAuthorization({
          request: approved.request,
          userId: member.id, // トークンに入るので ASCII にする
          metadata: { name: member.name },
          scope: approved.request.scope,
          props: { name: member.name, discordId: member.discordId } satisfies Props,
        });
        approved.headers.set("Location", redirectTo);
        return new Response(null, { status: 302, headers: approved.headers });
      }
      return new Response("Method not allowed", { status: 405 });
    } catch (e) {
      if (e instanceof AuthorizationError && (e as any).redirectTo) {
        return Response.redirect((e as any).redirectTo, 302);
      }
      if (e instanceof AuthorizationError) {
        return page(`<h1>つなげませんでした</h1><p>${escape((e as any).description ?? "")}</p><p>Claude の画面から、もう一度つないでください。</p>`, 400);
      }
      throw e;
    }
  },
};

const apiHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = ctx.props as Props | undefined;
    const skills = await skillCatalog();
    const name = props?.name ?? "不明な参加者";
    let aiRoles: Record<string, string> = {};
    try {
      aiRoles = JSON.parse(env.DISCORD_AI_ROLES || "{}");
    } catch {}
    const handler = createMcpHandler(() => buildServer(env.NOTION_TOKEN, name, {
        token: env.DISCORD_BOT_TOKEN,
        guildId: env.DISCORD_GUILD_ID,
        channels: (env.DISCORD_CHANNELS ?? "").split(","),
        me: props?.discordId ? { userId: props.discordId, aiRoleId: aiRoles[props.discordId] } : undefined,
        aiRoleIds: Object.values(aiRoles),
      }, skills), { route: "/mcp" });
    return handler(req, env, ctx);
  },
};

// 公開URLは、環境変数 PUBLIC_URL があればそれを、なければ最初のリクエストの origin を使う（リポジトリにアカウント固有のURLを書かないため）。
// OAuth のトークンはこの URL の /mcp に結び付けられる。
let provider: OAuthProvider<Env> | undefined;

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    provider ??= makeProvider(env.PUBLIC_URL || new URL(req.url).origin);
    return provider.fetch(req, env, ctx);
  },
};

const makeProvider = (origin: string) => new OAuthProvider<Env>({
  resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler: authHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  refreshTokenTTL: 60 * 60 * 24 * 90,
});
