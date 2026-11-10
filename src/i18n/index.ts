/**
 * Minimal i18n layer.
 *
 * Keys are the original Simplified Chinese strings, so zh-CN needs no dictionary
 * and the source stays readable. en / zh-TW dictionaries are typed against the
 * key set: a missing translation is a compile error.
 *
 * Placeholders are positional: tr("共 {0} 笔", n).
 */
import { en, type Key } from "./en";
import { zhTW } from "./zh-TW";

export type { Key };
export type Lang = "en" | "zh-TW" | "zh-CN";
export type LangSetting = Lang | "auto";

export const LANG_OPTIONS: { value: LangSetting; label: string }[] = [
  { value: "auto", label: "Auto (follow Obsidian)" },
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "zh-CN", label: "简体中文" },
];

let current: Lang = "zh-CN";

/**
 * Resolve the effective language. For "auto", pass Obsidian's UI language
 * (getLanguage(), 1.8.7+); older versions fall back to localStorage("language").
 * Obsidian uses "en" (or nothing) for English, "zh" for Simplified, "zh-TW" for Traditional.
 */
export function resolveLang(setting: LangSetting | undefined, uiLang?: string): Lang {
  if (setting === "en" || setting === "zh-TW" || setting === "zh-CN") return setting;
  let ui = uiLang ?? "";
  if (!ui) {
    try {
      ui = (typeof window !== "undefined" && window.localStorage?.getItem("language")) || "";
    } catch {
      ui = "";
    }
  }
  const l = ui.toLowerCase();
  if (l === "zh-tw" || l === "zh-hk" || l.includes("hant")) return "zh-TW";
  if (l.startsWith("zh")) return "zh-CN";
  return "en";
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Locale tag for Intl / toLocaleString. */
export function numberLocale(): string {
  return current === "en" ? "en-US" : current;
}

export function tr(key: Key, ...args: unknown[]): string {
  const dict: Record<string, string> | null =
    current === "en" ? en : current === "zh-TW" ? zhTW : null;
  const s = dict?.[key] ?? key;
  return args.length ? s.replace(/\{(\d+)\}/g, (m: string, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m)) : s;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short month label: "Oct" / "10月" (m is 1-based) */
export function monthShort(m: number): string {
  return current === "en" ? EN_MONTHS[m - 1] ?? String(m) : tr("{0}月", m);
}

/** Month + year: "Oct 2026" / "2026 年 10 月" (m is 1-based) */
export function monthYear(y: number, m: number): string {
  return current === "en" ? `${EN_MONTHS[m - 1] ?? m} ${y}` : tr("{0} 年 {1} 月", y, m);
}
