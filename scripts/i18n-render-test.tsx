/**
 * i18n render check: render every tab in en / zh-TW and make sure no
 * untranslated Simplified Chinese UI text leaks through.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JournalApp, Tab } from "../src/components/JournalApp";
import { Overview } from "../src/components/Overview";
import { buildSnapshot } from "../src/services/aggregate";
import { emptyQuery } from "../src/services/query";
import { setLang } from "../src/i18n";
import { Trade } from "../src/types";

function makeTrades(n = 40): Trade[] {
  const out: Trade[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(2026, 8, 17 + (i % 30));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const win = i % 3 !== 0;
    out.push({
      id: `t${i}`,
      date,
      time: `21:${String(10 + (i % 45)).padStart(2, "0")}`,
      symbol: ["MNQZ26", "BTC"][i % 2],
      direction: i % 2 === 0 ? "short" : "long",
      entry: 30000 + i,
      exit: 30000 + i + (win ? 20 : -12),
      quantity: 6,
      fees: 4.32,
      pnl: win ? 120 + i * 7 : -(60 + i * 5),
      setup: i % 5 === 0 ? "" : "Breakout",
      account: i % 7 === 0 ? "" : "AMP",
      stop: null,
      target: null,
      exitTime: `22:${String(10 + (i % 45)).padStart(2, "0")}:00`,
      holdSeconds: 1800 + i * 60,
      session: "ny",
      tags: ["trade"],
      notes: "",
    });
  }
  return out;
}

const trades = makeTrades();
const tabs: Tab[] = ["overview", "dashboard", "trades", "import"];
const CJK = /[一-鿿]/;
// Characters that only exist in Simplified Chinese (or are written differently in Traditional)
const SIMPLIFIED_ONLY = /[笔亏账导数设显选时这还没开关从对图录读删览单级净胜负损项条择务录总认识动为两种场后键据结复价统计]/;
let failed = 0;

function check(lang: "en" | "zh-TW", name: string, html: string) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
  const re = lang === "en" ? CJK : SIMPLIFIED_ONLY;
  const hits = [...new Set((text.match(new RegExp(`.{0,12}${re.source}.{0,12}`, "g")) ?? []).map((s) => s.trim()))];
  // placeholder sample data in the import tab is CSV content, not UI text
  const real = hits.filter((h) => !/2026-10-09,AAPL/.test(h));
  if (real.length) {
    failed++;
    console.log(`✗ [${lang}] ${name}: ${real.slice(0, 8).join(" | ")}`);
  } else {
    console.log(`✓ [${lang}] ${name}`);
  }
}

for (const lang of ["en", "zh-TW"] as const) {
  setLang(lang);
  for (const tab of tabs) {
    const html = renderToStaticMarkup(
      React.createElement(JournalApp, {
        trades,
        currency: "$",
        initialTab: tab,
        onImport: async () => ({ created: 0, skipped: 0 }),
        onDelete: async () => {},
        onDeleteMany: async () => {},
        onSetSetup: async () => {},
        onOpen: () => {},
        onLayoutChange: () => {},
        onCardsChange: () => {},
      } as never)
    );
    check(lang, `tab ${tab}`, html);
    if (tab === "dashboard") {
      const want = lang === "en" ? ["Win rate", "Net P&amp;L", "Daily P&amp;L", "Mon"] : ["勝率", "淨損益", "每日損益", "週一"];
      const miss = want.filter((w) => !html.includes(w));
      if (miss.length) {
        failed++;
        console.log(`✗ [${lang}] dashboard missing: ${miss.join(", ")}`);
      } else console.log(`✓ [${lang}] dashboard shows translated labels`);
    }
  }
  const snap = buildSnapshot(trades, emptyQuery("all"), "2026-10-20");
  check(lang, "overview insights", renderToStaticMarkup(React.createElement(Overview, { snapshot: snap, cur: "$" })));
}
setLang("zh-CN");

console.log(failed ? `\n${failed} 项失败` : "\n多语言渲染全部通过");
process.exit(failed ? 1 : 0);
