import { tr } from "../i18n";
import { Trade } from "../types";

/**
 * 数据体检。
 *
 * 只回答一件事：哪些交易缺了让统计成立所必需的字段。
 * 不做"打分"，也不评价交易好坏——缺字段是客观事实，好坏是另一回事。
 */

export type GapKind = "setup" | "stop" | "exitTime" | "tags" | "notes";

export interface GapMeta {
  label: string;
  /** 补上之后哪个功能才会亮 */
  hint: string;
}

export const GAP_META: Record<GapKind, GapMeta> = {
  setup: {
    get label() { return tr("缺策略"); },
    get hint() { return tr("补上策略后，策略维度的强项/短板才有意义"); },
  },
  stop: {
    get label() { return tr("缺止损"); },
    get hint() { return tr("补 stop 价格后，R 倍数和按风险的口径才能算"); },
  },
  exitTime: {
    get label() { return tr("缺平仓时间"); },
    get hint() { return tr("订单历史配对会自动带上；手工记录需要在 frontmatter 补 exitTime"); },
  },
  tags: {
    get label() { return tr("缺标签"); },
    get hint() { return tr("打上自己的标签，之后能按标签横向对比"); },
  },
  notes: {
    get label() { return tr("没写复盘"); },
    get hint() { return tr("正文太短，补两句当时的判断和情绪"); },
  },
};

export const GAP_KINDS: GapKind[] = ["setup", "stop", "exitTime", "tags", "notes"];

/** 导入时自动打的标签，不算"有标签" */
const AUTO_TAGS = new Set(["trade", "auto-paired", "import", "csv"]);

export function hasGap(t: Trade, kind: GapKind): boolean {
  switch (kind) {
    case "setup":
      const setup = t.setup.trim();
      // "未分类" may be stored literally in notes; also accept the translated label
      return !setup || setup === "未分类" || setup === tr("未分类");
    case "stop":
      return t.stop === null || !(t.stop > 0);
    case "exitTime":
      return !t.exitTime || t.holdSeconds === null || t.holdSeconds === undefined;
    case "tags":
      return !t.tags.some((x) => x.trim() && !AUTO_TAGS.has(x.trim()));
    case "notes":
      return t.notes.trim().length < 10;
  }
}

export interface GapStat extends GapMeta {
  kind: GapKind;
  count: number;
  /** 占比 0..1 */
  ratio: number;
}

/** 按缺口统计；数量为 0 的项直接不返回，免得界面上一排 0 */
export function auditTrades(trades: Trade[]): GapStat[] {
  const total = trades.length;
  if (!total) return [];
  const out: GapStat[] = [];
  for (const kind of GAP_KINDS) {
    let count = 0;
    for (const t of trades) if (hasGap(t, kind)) count++;
    if (count > 0) out.push({ kind, ...GAP_META[kind], count, ratio: count / total });
  }
  // 缺口大的排前面，先修影响面最广的
  return out.sort((a, b) => b.count - a.count);
}
