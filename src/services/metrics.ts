import { numberLocale, tr } from "../i18n";
import { Trade } from "../types";
import {
  DayPnl,
  DrawdownEpisode,
  DrawdownStats,
  Summary,
  dailyPnl,
  drawdownEpisodes,
  drawdownStats,
  summarize,
} from "./analytics";

/**
 * 指标注册表。
 *
 * 每个指标是一个纯函数，只依赖「一次统计结果」；新增指标不需要改渲染层，
 * 只要往 REGISTRY 里加一条。卡片、环比、导出全部从同一张表取。
 */

export type MetricFormat = "money" | "pct" | "num" | "ratio" | "duration" | "days";
export type MetricCategory = "performance" | "volume" | "average" | "risk";

/** 一次算好，所有指标共用，避免每个指标都遍历一遍交易 */
export interface MetricBase {
  trades: Trade[];
  s: Summary;
  days: DayPnl[];
  /** 平均持仓秒数；没有可用的平仓时间时为 null */
  holdAvg: number | null;
  /** 参与持仓时间统计的笔数 */
  holdCount: number;
  /** 回撤分段明细 */
  dd: DrawdownEpisode[];
  /** 回撤汇总（水下时间、平均恢复…） */
  ddStats: DrawdownStats;
}

export interface MetricDef {
  id: string;
  name: string;
  /** 短说明，鼠标悬停用 */
  desc: string;
  category: MetricCategory;
  format: MetricFormat;
  /** 没有意义时返回 null（例如没有亏损笔时的盈亏比），UI 显示 — */
  compute: (b: MetricBase) => number | null;
  /**
   * 展示用变换：把"数值大小"转成"带方向的展示值"。
   * 最大回撤算出来是正数（跌幅），但展示成负数才不会被读成盈利。
   */
  display?: (v: number) => number;
  hint?: (b: MetricBase) => string;
}

export function makeBase(trades: Trade[]): MetricBase {
  const s = summarize(trades);
  const holdValues = trades
    .map((t) => t.holdSeconds)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  return {
    trades,
    s,
    days: dailyPnl(trades),
    holdAvg: holdValues.length ? holdValues.reduce((a, b) => a + b, 0) / holdValues.length : null,
    holdCount: holdValues.length,
    dd: drawdownEpisodes(trades),
    ddStats: drawdownStats(trades),
  };
}

const safeRatio = (n: number, d: number): number | null => (d ? n / d : null);

export const REGISTRY: MetricDef[] = [
  /* ---------- performance ---------- */
  {
    id: "netPnL",
    get name() { return tr("净盈亏"); },
    get desc() { return tr("已扣手续费的合计盈亏"); },
    category: "performance",
    format: "money",
    compute: (b) => b.s.netPnl,
    hint: (b) => tr("手续费 {0}", b.s.fees.toFixed(2)),
  },
  {
    id: "winRate",
    get name() { return tr("胜率"); },
    get desc() { return tr("盈利笔数 ÷ 有结果的笔数（不含打平）"); },
    category: "performance",
    format: "pct",
    compute: (b) => (b.s.wins + b.s.losses ? b.s.winRate : null),
    hint: (b) => tr("{0} 胜 / {1} 负", b.s.wins, b.s.losses),
  },
  {
    id: "profitFactor",
    get name() { return tr("盈亏比"); },
    get desc() { return tr("总盈利 ÷ 总亏损（毛额，不含手续费）"); },
    category: "performance",
    format: "ratio",
    compute: (b) => (Number.isFinite(b.s.profitFactor) ? b.s.profitFactor : null),
    hint: (b) => tr("毛利 {0} / 毛亏 {1}", b.s.grossProfit.toFixed(2), b.s.grossLoss.toFixed(2)),
  },
  {
    id: "expectancy",
    get name() { return tr("期望值 / 笔"); },
    get desc() { return tr("净盈亏 ÷ 交易笔数"); },
    category: "performance",
    format: "money",
    compute: (b) => (b.s.count ? b.s.expectancy : null),
    hint: (b) => tr("{0} 笔", b.s.count),
  },
  {
    id: "maxDrawdown",
    get name() { return tr("最大回撤"); },
    get desc() { return tr("权益曲线从高点到低点的最大跌幅"); },
    category: "performance",
    format: "money",
    compute: (b) => b.s.maxDrawdown,
    // 回撤是"跌了多少"，展示成负数才不会和盈利混淆
    display: (v) => -Math.abs(v),
    hint: () => tr("按平仓顺序累计"),
  },
  {
    id: "currentDrawdown",
    get name() { return tr("当前回撤"); },
    get desc() { return tr("最新权益距历史最高点还差多少；0 表示正在新高"); },
    category: "risk",
    format: "money",
    compute: (b) => (b.trades.length ? b.ddStats.current : null),
    display: (v) => -Math.abs(v),
    hint: (b) => (b.ddStats.current === 0 ? tr("正在历史新高") : tr("水下中")),
  },
  {
    id: "avgRecovery",
    get name() { return tr("平均恢复"); },
    get desc() { return tr("每次回撤后，用几个交易日回到前高（只算已收复的）"); },
    category: "risk",
    format: "days",
    compute: (b) => b.ddStats.avgRecoveryDays,
    hint: (b) => {
      const done = b.dd.filter((e) => e.recovered).length;
      return tr("{0}/{1} 段已收复", done, b.dd.length);
    },
  },
  {
    id: "longestDrawdown",
    get name() { return tr("最长回撤"); },
    get desc() { return tr("最久的一段回撤持续了几个交易日（含等待收复的时间）"); },
    category: "risk",
    format: "days",
    compute: (b) => b.ddStats.longestDays,
    hint: (b) => (b.dd.length ? (b.ddStats.longestRecovered ? tr("已收复") : tr("仍未收复")) : tr("没有回撤")),
  },
  {
    id: "timeUnderwater",
    get name() { return tr("水下时间"); },
    get desc() { return tr("权益低于前高的交易日占比；越低说明资金曲线越顺"); },
    category: "risk",
    format: "pct",
    compute: (b) => (b.days.length ? b.ddStats.timeUnderwater : null),
    hint: (b) => tr("{0} 个交易日", b.days.length),
  },
  {
    id: "bestDay",
    get name() { return tr("最佳单日"); },
    get desc() { return tr("单日盈亏的最大值"); },
    category: "performance",
    format: "money",
    compute: (b) => (b.days.length ? Math.max(...b.days.map((d) => d.pnl)) : null),
  },
  {
    id: "worstDay",
    get name() { return tr("最差单日"); },
    get desc() { return tr("单日盈亏的最小值"); },
    category: "performance",
    format: "money",
    compute: (b) => (b.days.length ? Math.min(...b.days.map((d) => d.pnl)) : null),
  },
  {
    id: "bestTrade",
    get name() { return tr("最大单笔盈利"); },
    get desc() { return tr("单笔盈亏的最大值"); },
    category: "performance",
    format: "money",
    compute: (b) => (b.trades.length ? b.s.bestTrade : null),
  },
  {
    id: "worstTrade",
    get name() { return tr("最大单笔亏损"); },
    get desc() { return tr("单笔盈亏的最小值"); },
    category: "performance",
    format: "money",
    compute: (b) => (b.trades.length ? b.s.worstTrade : null),
  },
  {
    id: "longestWinStreak",
    get name() { return tr("最长连胜"); },
    get desc() { return tr("连续盈利的最大笔数"); },
    category: "performance",
    format: "num",
    compute: (b) => b.s.maxWinStreak,
  },
  {
    id: "longestLossStreak",
    get name() { return tr("最长连亏"); },
    get desc() { return tr("连续亏损的最大笔数"); },
    category: "performance",
    format: "num",
    compute: (b) => b.s.maxLossStreak,
  },

  /* ---------- volume ---------- */
  {
    id: "numTrades",
    get name() { return tr("总交易数"); },
    get desc() { return tr("当前时间档内的交易笔数"); },
    category: "volume",
    format: "num",
    compute: (b) => b.s.count,
    hint: (b) => tr("{0} 个交易日", b.days.length),
  },
  {
    id: "numWinTrades",
    get name() { return tr("盈利笔数"); },
    category: "volume",
    get desc() { return tr("盈亏 > 0 的笔数"); },
    format: "num",
    compute: (b) => b.s.wins,
  },
  {
    id: "numLossTrades",
    get name() { return tr("亏损笔数"); },
    get desc() { return tr("盈亏 < 0 的笔数"); },
    category: "volume",
    format: "num",
    compute: (b) => b.s.losses,
  },
  {
    id: "tradingDays",
    get name() { return tr("交易天数"); },
    get desc() { return tr("有交易的自然日数量"); },
    category: "volume",
    format: "num",
    compute: (b) => b.days.length,
  },
  {
    id: "feesTotal",
    get name() { return tr("手续费合计"); },
    get desc() { return tr("当前时间档内的手续费总额"); },
    category: "volume",
    format: "money",
    compute: (b) => b.s.fees,
  },

  /* ---------- average ---------- */
  {
    id: "avgWin",
    get name() { return tr("平均盈利"); },
    get desc() { return tr("盈利笔的平均盈亏"); },
    category: "average",
    format: "money",
    compute: (b) => (b.s.wins ? b.s.avgWin : null),
  },
  {
    id: "avgLoss",
    get name() { return tr("平均亏损"); },
    get desc() { return tr("亏损笔的平均亏损（正数表示亏损额）"); },
    category: "average",
    format: "money",
    compute: (b) => (b.s.losses ? b.s.avgLoss : null),
  },
  {
    id: "avgRR",
    get name() { return tr("平均盈亏比"); },
    get desc() { return tr("平均盈利 ÷ 平均亏损"); },
    category: "average",
    format: "ratio",
    compute: (b) => (b.s.losses && b.s.wins ? safeRatio(b.s.avgWin, b.s.avgLoss) : null),
    hint: () => tr("超过 1 才算正的期望"),
  },
  {
    id: "avgHoldTime",
    get name() { return tr("平均持仓"); },
    get desc() { return tr("开仓到平仓的平均时长"); },
    category: "average",
    format: "duration",
    compute: (b) => b.holdAvg,
    hint: (b) =>
      b.holdCount < b.trades.length ? tr("{0}/{1} 笔有平仓时间", b.holdCount, b.trades.length) : tr("全部有平仓时间"),
  },
  {
    id: "avgDailyPnl",
    get name() { return tr("日均盈亏"); },
    get desc() { return tr("净盈亏 ÷ 交易天数"); },
    category: "average",
    format: "money",
    compute: (b) => (b.days.length ? b.s.netPnl / b.days.length : null),
  },
];

export const REGISTRY_BY_ID = new Map(REGISTRY.map((m) => [m.id, m]));

/** 仪表盘默认展示的 6 张卡 */
export const DEFAULT_CARDS = [
  "netPnL",
  "numTrades",
  "winRate",
  "profitFactor",
  "expectancy",
  "maxDrawdown",
];

export function pickMetrics<T extends { id: string }>(defs: T[], ids: string[]): T[] {
  const map = new Map(defs.map((d) => [d.id, d]));
  return ids.map((id) => map.get(id)).filter((d): d is T => Boolean(d));
}

/** 按 format 格式化；null 统一显示 — */
export function formatMetric(value: number | null | undefined, format: MetricFormat, cur = "¥"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (format) {
    case "money":
      return money(value, cur);
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "ratio":
      return Number.isFinite(value) ? value.toFixed(2) : "∞";
    case "duration":
      return duration(value);
    case "days":
      return tr("{0} 天", Math.round(value));
    case "num":
    default:
      return Math.abs(value) >= 1000 ? value.toLocaleString(numberLocale()) : String(Math.round(value * 100) / 100);
  }
}

function money(v: number, cur: string): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const body = abs >= 1000 ? abs.toLocaleString(numberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return `${sign}${cur}${body}`;
}

/** 秒 → 人话 */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const min = seconds / 60;
  if (min < 1) return tr("不到 1 分钟");
  if (min < 60) return tr("{0} 分钟", Math.round(min));
  const h = min / 60;
  if (h < 24) return h < 10 ? tr("{0} 小时", h.toFixed(1)) : tr("{0} 小时", Math.round(h));
  const d = h / 24;
  return tr("{0} 天", d.toFixed(1));
}

/** 环比：返回差值和方向；无法比较时 delta 为 null */
export function compareMetric(
  cur: number | null,
  prev: number | null,
  format: MetricFormat
): { delta: number | null; text: string; tone: "up" | "down" | "flat" } {
  if (cur === null || prev === null || !Number.isFinite(cur) || !Number.isFinite(prev)) {
    return { delta: null, text: "—", tone: "flat" };
  }
  const delta = cur - prev;
  const tone = Math.abs(delta) < 1e-9 ? "flat" : delta > 0 ? "up" : "down";
  const abs = Math.abs(delta);
  let body: string;
  if (format === "pct") body = `${(abs * 100).toFixed(1)}%`;
  else if (format === "ratio") body = abs.toFixed(2);
  else if (format === "duration") body = duration(abs);
  else if (format === "days") body = tr("{0} 天", Math.round(abs));
  else if (format === "money") body = abs.toFixed(2);
  else body = abs >= 1000 ? Math.round(abs).toLocaleString(numberLocale()) : String(Math.round(abs * 100) / 100);
  return { delta, text: tone === "up" ? `+${body}` : tone === "down" ? `-${body}` : body, tone };
}
