// [LINE-06] Auto-reply content for the official account and the matching rules.
// Content: src/data/line-replies.json (written by CODE in the content lane; shared contract):
//   { version: 1, greeting: { text }, fallback: { text }, handoff: { keywords[], text },
//     intents: [{ id, keywords[], reply: { text }, quickReplies: [{ label, text }] }] }
// tsconfig.json includes that file by name so `medusa build` emits it next to the compiled
// code (.medusa/server/src/data/); this loader reads it at runtime and tolerates its absence
// (built-in minimal replies below). A file that exists but breaks the contract also falls back,
// and the caller logs the problem.
// Limits checked: at most 13 quick-reply buttons (line-openapi messaging-api.yml QuickReply
// maxItems 13; developers.line.biz/en/docs/messaging-api/using-quick-reply/).
// TODO(需查證): text and button-label length limits are not stated in the fetched sources, so
// they are not checked here.
import { readFileSync } from "fs"
import { join } from "path"
import { MedusaError } from "@medusajs/framework/utils"

export type QuickReplyButton = { label: string; text: string }
export type LineIntent = { id: string; keywords: string[]; reply: { text: string }; quickReplies: QuickReplyButton[] }
export type LineReplies = {
  version: 1
  greeting: { text: string }
  fallback: { text: string }
  handoff: { keywords: string[]; text: string }
  intents: LineIntent[]
}

export const MAX_QUICK_REPLIES = 13

// Used only while src/data/line-replies.json is absent or invalid.
export const BUILT_IN_REPLIES: LineReplies = {
  version: 1,
  greeting: { text: "您好，這裡是 Dr.Nature。想問訂單、出貨或標示上的內容，直接回覆即可。" },
  fallback: { text: "收到。這題我們請同事確認後回覆您；也可以回覆「真人」轉接。" },
  handoff: { keywords: ["真人"], text: "收到。這題我們請同事確認後回覆您。" },
  intents: [],
}

export const REPLIES_PATH = join(__dirname, "../../data/line-replies.json")

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0

/** Validates the content file against the shared contract; throws with every problem found. */
export function parseLineReplies(raw: unknown): LineReplies {
  const problems: string[] = []
  const textAt = (v: unknown, where: string) => {
    if (!isObject(v) || !nonEmpty(v.text)) problems.push(`${where}.text must be a non-empty string`)
  }
  const keywordsAt = (v: unknown, where: string, min: number) => {
    if (!Array.isArray(v) || v.length < min || !v.every(nonEmpty)) {
      problems.push(`${where} must be an array of${min ? " at least one" : ""} non-empty strings`)
    }
  }
  if (!isObject(raw)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "line-replies: not a JSON object")
  }
  if (raw.version !== 1) problems.push("version must be 1")
  textAt(raw.greeting, "greeting")
  textAt(raw.fallback, "fallback")
  textAt(raw.handoff, "handoff")
  keywordsAt(isObject(raw.handoff) ? raw.handoff.keywords : undefined, "handoff.keywords", 0)
  if (!Array.isArray(raw.intents)) {
    problems.push("intents must be an array")
  } else {
    const ids = new Set<string>()
    raw.intents.forEach((intent, i) => {
      const where = `intents[${i}]`
      if (!isObject(intent)) {
        problems.push(`${where} must be an object`)
        return
      }
      if (!nonEmpty(intent.id)) problems.push(`${where}.id must be a non-empty string`)
      else if (ids.has(intent.id)) problems.push(`${where}.id "${intent.id}" is repeated`)
      else ids.add(intent.id)
      keywordsAt(intent.keywords, `${where}.keywords`, 1)
      textAt(intent.reply, `${where}.reply`)
      const quick = intent.quickReplies ?? []
      if (!Array.isArray(quick)) {
        problems.push(`${where}.quickReplies must be an array`)
      } else {
        if (quick.length > MAX_QUICK_REPLIES) problems.push(`${where}.quickReplies has ${quick.length} buttons (LINE allows ${MAX_QUICK_REPLIES})`)
        quick.forEach((b, j) => {
          if (!isObject(b) || !nonEmpty(b.label) || !nonEmpty(b.text)) {
            problems.push(`${where}.quickReplies[${j}] needs a non-empty label and text`)
          }
        })
      }
    })
  }
  if (problems.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `line-replies: ${problems.join("; ")}`)
  }
  const r = raw as unknown as LineReplies
  return {
    version: 1,
    greeting: { text: r.greeting.text },
    fallback: { text: r.fallback.text },
    handoff: { keywords: [...r.handoff.keywords], text: r.handoff.text },
    intents: r.intents.map((i) => ({
      id: i.id,
      keywords: [...i.keywords],
      reply: { text: i.reply.text },
      quickReplies: (i.quickReplies ?? []).map((b) => ({ label: b.label, text: b.text })),
    })),
  }
}

export type LoadedReplies = { replies: LineReplies; source: "file" | "built-in"; problem?: string }

/** Reads the content file; absent -> built-in replies; unreadable or invalid -> built-in + problem. */
export function loadLineReplies(path: string = REPLIES_PATH, read: (p: string) => string = (p) => readFileSync(p, "utf8")): LoadedReplies {
  let text: string
  try {
    text = read(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { replies: BUILT_IN_REPLIES, source: "built-in" }
    }
    return { replies: BUILT_IN_REPLIES, source: "built-in", problem: `line-replies: cannot read the file (${(e as NodeJS.ErrnoException).code ?? "error"})` }
  }
  try {
    return { replies: parseLineReplies(JSON.parse(text)), source: "file" }
  } catch (e) {
    return { replies: BUILT_IN_REPLIES, source: "built-in", problem: e instanceof SyntaxError ? "line-replies: not valid JSON" : (e as Error).message }
  }
}

export type ReplyMatch = { kind: "handoff" } | { kind: "intent"; intent: LineIntent; keyword: string } | { kind: "fallback" }

// Full-width / half-width forms and letter case do not matter ("ＡＴＭ" = "atm").
const normalize = (s: string) => s.normalize("NFKC").toLowerCase()

/**
 * A handoff keyword anywhere in the text wins (the user asked for a person). Otherwise the
 * intent with the LONGEST matching keyword wins; on equal length the earlier intent in the file.
 * Nothing matched -> fallback.
 */
export function matchReply(text: string, replies: LineReplies): ReplyMatch {
  const t = normalize(text)
  if (replies.handoff.keywords.some((k) => t.includes(normalize(k)))) {
    return { kind: "handoff" }
  }
  let best: { intent: LineIntent; keyword: string; length: number } | undefined
  for (const intent of replies.intents) {
    for (const keyword of intent.keywords) {
      const k = normalize(keyword)
      if (k && t.includes(k) && (!best || k.length > best.length)) {
        best = { intent, keyword, length: k.length }
      }
    }
  }
  return best ? { kind: "intent", intent: best.intent, keyword: best.keyword } : { kind: "fallback" }
}
