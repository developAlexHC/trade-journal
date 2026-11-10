import { numberLocale, tr } from "../i18n";
import { Trade } from "../types";
import { DashboardSnapshot } from "./aggregate";
import { GroupStat, byWeekday, groupBy } from "./analytics";
import { auditTrades } from "./quality";

/**
 * 概要视图的「结论层」。
 *
 * 这里只做一件事：把已经算好的数字翻译成人话。
 * 所有判断都基于可复现的阈值，不猜、不预测、不给玄学建议——
 * 用户能顺着每条结论回到仪表盘核对。
 */

export type InsightTone = "good" | "bad" | "info";

export interface Insight {
  id: string;
  tone: InsightTone;
  /** 一句话结论 */
  text: string;
  /** 支撑数字 / 上下文 */
  detail?: string;
}

const TONE_ORDER: Record<InsightTone, number> = { bad: 0, good: 1, info: 2 };

function fmtMoney(v: number, cur: string): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const body =
    abs >= 1000
      ? abs.toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : abs.toFixed(2);
  return `${sign}${cur}${body}`;
}

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const plural = (n: number, unit: string) => `${n} ${unit}`;

/** 概览顶部那句话：本期发生了什么 */
export function headline(s: DashboardSnapshot, cur: string): string {
  const { base, prevBase } = s;
  if (!base.s.count) return tr("这个区间没有交易。");

  const days = base.days.length;
  const verb = base.s.netPnl >= 0 ? tr("净赚") : tr("净亏");
  const parts = [
    tr("{0} 个交易日、{1} 笔，{2} {3}", days, base.s.count, verb, fmtMoney(Math.abs(base.s.netPnl), cur)),
    tr("胜率 {0}", pct(base.s.winRate)),
  ];
  if (base.s.losses > 0 && base.s.wins > 0) parts.push(tr("盈亏比 {0}", base.s.profitFactor.toFixed(2)));

  if (prevBase.s.count) {
    const delta = base.s.netPnl - prevBase.s.netPnl;
    parts.push(
      delta === 0
        ? tr("与上期打平")
        : `${delta > 0 ? tr("比上期多") : tr("比上期少")} ${fmtMoney(Math.abs(delta), cur)}`
    );
  }
  return parts.join(tr("，")) + tr("。");
}

export interface Highlight {
  dimension: string;
  key: string;
  pnl: number;
  count: number;
  winRate: number;
}

/** 只看至少打过 2 笔的维度，避免单笔运气被当成规律 */
const MIN_SAMPLE = 2;

export function highlights(trades: Trade[]): { strong: Highlight[]; weak: Highlight[] } {
  const dims: { name: string; items: GroupStat[] }[] = [
    { name: tr("策略"), items: groupBy(trades, (t) => t.setup) },
    { name: tr("标的"), items: groupBy(trades, (t) => t.symbol) },
    { name: tr("星期"), items: byWeekday(trades).filter((w) => w.key !== tr("未知")) },
  ];

  const strong: Highlight[] = [];
  const weak: Highlight[] = [];

  for (const d of dims) {
    const usable = d.items.filter((i) => i.count >= MIN_SAMPLE);
    if (!usable.length) continue;
    let max = usable[0];
    let min = usable[0];
    for (const i of usable) {
      if (i.pnl > max.pnl) max = i;
      if (i.pnl < min.pnl) min = i;
    }
    if (max.pnl > 0) strong.push({ dimension: d.name, ...max });
    if (min.pnl < 0 && min.key !== max.key) weak.push({ dimension: d.name, ...min });
  }

  strong.sort((a, b) => b.pnl - a.pnl);
  weak.sort((a, b) => a.pnl - b.pnl);
  return { strong, weak };
}

/** 规则化的结论清单。阈值写死在这里，方便以后调 */
export function buildInsights(s: DashboardSnapshot, cur: string): Insight[] {
  const b = s.base;
  const out: Insight[] = [];
  const n = b.s.count;
  if (!n) return out;

  // 样本量先开口：小样本下所有比率都不可靠
  if (n < 20) {
    out.push({
      id: "sample",
      tone: "info",
      text: tr("样本只有 {0}，胜率和盈亏比的波动会很大", plural(n, tr("笔"))),
      detail: tr("同一个策略再打 20 笔，数字可能完全变样"),
    });
  }

  // 单笔亏损 vs 平均盈利：决定「一次失手要几笔才补回来」
  if (b.s.losses > 0 && b.s.avgWin > 0) {
    const worst = Math.abs(b.s.worstTrade);
    const ratio = worst / b.s.avgWin;
    if (ratio >= 2) {
      out.push({
        id: "tailRisk",
        tone: "bad",
        text: tr("最大单笔亏损是平均盈利的 {0} 倍", ratio.toFixed(1)),
        detail: tr("亏一次要 {0} 笔盈利才补回来（{1} / {2}）", Math.ceil(ratio), fmtMoney(b.s.worstTrade, cur), fmtMoney(b.s.avgWin, cur)),
      });
    }
  }

  if (b.s.maxLossStreak >= 4) {
    out.push({
      id: "lossStreak",
      tone: "bad",
      text: tr("最长连亏 {0}", plural(b.s.maxLossStreak, tr("笔"))),
      detail: tr("连亏段通常是仓位和情绪同时失控的地方"),
    });
  }

  // 利润集中度：只有一个策略在赚钱，说明样本还不足以证明别的策略有效
  const setups = groupBy(b.trades, (t) => t.setup).filter((g) => g.pnl > 0);
  if (b.s.netPnl > 0 && setups.length) {
    const top = setups[0];
    const share = top.pnl / b.s.netPnl;
    if (share >= 0.6 && b.s.netPnl > 0) {
      out.push({
        id: "concentration",
        tone: "info",
        text: tr("{0} 的利润来自「{1}」", pct(share), top.key),
        detail: tr("{0} 笔带来 {1}，其余策略合计只占 {2}", top.count, fmtMoney(top.pnl, cur), pct(1 - share)),
      });
    }
  }

  // 水下时间：比最大回撤更能反映「拿不拿得住」
  if (b.days.length >= 5) {
    const tu = b.ddStats.timeUnderwater;
    if (tu >= 0.5) {
      out.push({
        id: "underwater",
        tone: "bad",
        text: tr("{0} 的交易日都在水下", pct(tu)),
        detail: tr("权益低于前高的日子有 {0} 天，共 {1} 个交易日", Math.round(tu * b.days.length), b.days.length),
      });
    } else if (tu <= 0.2) {
      out.push({
        id: "underwater",
        tone: "good",
        text: tr("只有 {0} 的交易日在水下", pct(tu)),
        detail: tr("资金曲线基本贴着新高走"),
      });
    }
  }

  // 当前仍被套：给一个明确的"还差多少"
  if (b.ddStats.current > 0) {
    const peak = b.s.netPnl + b.ddStats.current;
    const ratio = peak > 0 ? b.ddStats.current / peak : 0;
    out.push({
      id: "currentDd",
      tone: "info",
      text: tr("当前还在水下 {0}", fmtMoney(b.ddStats.current, cur)),
      detail: ratio > 0 ? tr("距前高回落 {0}，需要这么多盈利才能回本", pct(ratio, 1)) : undefined,
    });
  }

  // 手续费：小账户最容易忽略的漏损
  if (b.s.fees > 0 && b.s.grossProfit > 0) {
    const rate = b.s.fees / b.s.grossProfit;
    if (rate >= 0.15) {
      out.push({
        id: "fees",
        tone: "bad",
        text: tr("手续费吃掉毛利的 {0}", pct(rate)),
        detail: tr("{0} 手续费 / {1} 毛利", fmtMoney(b.s.fees, cur), fmtMoney(b.s.grossProfit, cur)),
      });
    }
  }

  // 缺策略：直接说清"这一维现在没有信息量"
  const setupGap = auditTrades(b.trades).find((g) => g.kind === "setup");
  if (setupGap && setupGap.count >= 3 && setupGap.ratio >= 0.3) {
    out.push({
      id: "setupGap",
      tone: "info",
      text: tr("{0} 笔还没填策略", setupGap.count),
      detail: tr("策略维度的强项/短板现在只能看到一个「未分类」，补齐后才有对比价值"),
    });
  }

  // 数据缺口要摆明，不能让用户以为指标坏了
  const withStop = b.trades.filter((t) => typeof t.stop === "number" && t.stop > 0).length;
  if (n > 0) {
    out.push({
      id: "stopCoverage",
      tone: "info",
      text:
        withStop === 0
          ? tr("R 倍数暂不可用：{0} 笔里 0 笔填了止损价", n)
          : tr("R 倍数可覆盖 {0}/{1} 笔", withStop, n),
      detail:
        withStop === 0
          ? tr("在笔记 frontmatter 补 stop: 价格，卡片和回撤统计会自动用上")
          : undefined,
    });
  }

  return out.sort((a, x) => TONE_ORDER[a.tone] - TONE_ORDER[x.tone]);
}
