import { LANG_OPTIONS, LangSetting, resolveLang, setLang, tr } from "./i18n";
import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  getLanguage,
  type SettingDefinitionItem,
} from "obsidian";
import { JournalView, VIEW_TYPE } from "./views/JournalView";
import { TradeStore } from "./services/store";
import { DEFAULT_LAYOUT, WidgetLayout, normalizeLayout } from "./services/layout";
import type { Tab } from "./components/JournalApp";

/** Obsidian's UI language; getLanguage() only exists on 1.8.7+ */
function obsidianLanguage(): string | undefined {
  try {
    return typeof getLanguage === "function" ? getLanguage() : undefined;
  } catch {
    return undefined;
  }
}

/** main = 主区域新标签页；side = 右侧边栏 */
type Placement = "main" | "side";

interface TradeJournalSettings {
  folder: string;
  currency: string;
  /** 点击丝带/默认命令时在哪里打开 */
  openInMainArea: boolean;
  /** 仪表盘上显示哪些指标卡，按数组顺序排列 */
  metricCards: string[];
  /** 仪表盘组件顺序与尺寸 */
  layout: WidgetLayout[];
  /** 打平区间：|pnl| ≤ 这个值算打平，不计入胜负 */
  breakEven: number;
  /** UI language; "auto" follows Obsidian's own language */
  language: LangSetting;
}

const DEFAULT_SETTINGS: TradeJournalSettings = {
  folder: "Trading",
  currency: "¥",
  openInMainArea: true,
  metricCards: [
    "netPnL",
    "numTrades",
    "winRate",
    "profitFactor",
    "expectancy",
    "maxDrawdown",
  ],
  layout: DEFAULT_LAYOUT,
  breakEven: 0,
  language: "auto",
};

export default class TradeJournalPlugin extends Plugin {
  settings: TradeJournalSettings = DEFAULT_SETTINGS;
  store!: TradeStore;

  private mainLeaf: WorkspaceLeaf | null = null;
  private sideLeaf: WorkspaceLeaf | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    setLang(resolveLang(this.settings.language, obsidianLanguage()));
    this.store = new TradeStore(this.app, this.settings.folder, this.settings.breakEven);

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new JournalView(leaf, this));

    this.addRibbonIcon("chart-line", tr("交易日志"), () => void this.activate());
    this.addCommand({
      id: "open-journal",
      name: tr("打开交易日志"),
      callback: () => void this.activate(),
    });
    this.addCommand({
      id: "open-journal-main",
      name: tr("在主区域（新标签页）打开交易日志"),
      callback: () => void this.activate(undefined, "main"),
    });
    this.addCommand({
      id: "open-journal-side",
      name: tr("在右侧边栏打开交易日志"),
      callback: () => void this.activate(undefined, "side"),
    });
    this.addCommand({
      id: "import-csv",
      name: tr("导入 CSV 交易记录"),
      callback: () => void this.activate("import"),
    });

    this.addSettingTab(new TradeJournalSettingTab(this.app, this));
  }

  private alive(l: WorkspaceLeaf | null): l is WorkspaceLeaf {
    return !!l && l.view?.getViewType?.() === VIEW_TYPE;
  }

  private async create(placement: Placement): Promise<WorkspaceLeaf> {
    const leaf =
      placement === "main"
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    if (placement === "main") this.mainLeaf = leaf;
    else this.sideLeaf = leaf;
    return leaf;
  }

  /**
   * 打开交易日志。
   * @param tab 初始页签
   * @param placement 指定位置；不传则按设置，且已有视图时直接复用
   */
  async activate(tab?: Tab, placement?: Placement): Promise<void> {
    const want: Placement = placement ?? (this.settings.openInMainArea ? "main" : "side");
    let leaf: WorkspaceLeaf | null = null;

    if (placement) {
      // 明确指定位置：只复用那个位置的视图，没有就新建
      const cached = want === "main" ? this.mainLeaf : this.sideLeaf;
      if (this.alive(cached)) leaf = cached;
    } else {
      // 默认行为：已经开着就切过去，不再开第二个
      for (const l of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (this.alive(l)) {
          leaf = l;
          break;
        }
      }
    }

    if (!leaf) leaf = await this.create(want);

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof JournalView && tab) {
      leaf.view.setTab(tab);
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<TradeJournalSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // 配置可能来自旧版本或被手改过，统一清洗一次
    this.settings.layout = normalizeLayout(this.settings.layout);
    const be = Number(this.settings.breakEven);
    this.settings.breakEven = Number.isFinite(be) && be > 0 ? be : 0;
    if (!LANG_OPTIONS.some((o) => o.value === this.settings.language)) this.settings.language = "auto";
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.store = new TradeStore(this.app, this.settings.folder, this.settings.breakEven);
  }

  /** Switch UI language and rebuild open views so every label is re-evaluated */
  async applyLanguage(lang: LangSetting): Promise<void> {
    this.settings.language = lang;
    setLang(resolveLang(lang, obsidianLanguage()));
    await this.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof JournalView) leaf.view.remount();
    }
  }

  /** 设置改了影响已渲染的数据时，让所有打开的视图重新读一遍 */
  reloadViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof JournalView) void leaf.view.reload();
    }
  }
}

class TradeJournalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TradeJournalPlugin) {
    super(app, plugin);
  }

  /**
   * Obsidian 1.13+ 的声明式设置，让这几项能被全局设置搜索索引到。
   * 旧版本仍然走下面的 display()，两边描述的是同一组配置。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Language / 語言",
        desc: tr("界面语言。「自动」会跟随 Obsidian 的语言设置。"),
        control: {
          type: "dropdown",
          key: "language",
          defaultValue: "auto",
          options: Object.fromEntries(LANG_OPTIONS.map((o) => [o.value, o.label])),
        },
      },
      {
        name: tr("在主区域打开"),
        desc: tr("关闭后默认打开到右侧边栏；两个位置都能用视图右上角的按钮随时切换。"),
        control: { type: "toggle", key: "openInMainArea", defaultValue: true },
      },
      {
        name: tr("交易笔记目录"),
        desc: tr("交易记录会以 Markdown 形式保存在 vault 的这个目录下"),
        control: {
          type: "text",
          key: "folder",
          placeholder: "Trading",
          defaultValue: "Trading",
        },
      },
      {
        name: tr("货币符号"),
        desc: tr("显示盈亏时使用的前缀，例如 ¥ 或 $"),
        control: { type: "text", key: "currency", placeholder: "¥", defaultValue: "¥" },
      },
      {
        name: tr("打平区间"),
        desc: tr("单笔盈亏落在这个范围内算打平，不计入胜率、也不打断连胜连亏。填 0 表示只有刚好 0 才算平。"),
        control: { type: "text", key: "breakEven", placeholder: "0", defaultValue: "0" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const text = typeof value === "string" ? value.trim() : "";

    if (key === "language") {
      await this.plugin.applyLanguage(value as LangSetting);
      this.display();
      return;
    }
    if (key === "folder") settings.folder = text || "Trading";
    else if (key === "currency") settings.currency = text || "¥";
    else if (key === "breakEven") {
      const n = Number(text);
      settings.breakEven = Number.isFinite(n) && n > 0 ? n : 0;
    } else settings[key] = value;

    await this.plugin.saveSettings();
    if (key === "currency") this.plugin.reloadViews();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Language / 語言")
      .setDesc(tr("界面语言。「自动」会跟随 Obsidian 的语言设置。"))
      .addDropdown((d) => {
        for (const o of LANG_OPTIONS) d.addOption(o.value, o.label);
        d.setValue(this.plugin.settings.language).onChange(async (v) => {
          await this.plugin.applyLanguage(v as LangSetting);
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(tr("默认打开位置"))
      .setDesc(
        tr("主区域：占满中间的编辑区，适合看图表；右侧边栏：一直挂在右边，边看行情边记。两个位置都能随时切换（视图右上角有按钮）。")
      )
      .addDropdown((d) =>
        d
          .addOption("main", tr("主区域（新标签页）"))
          .addOption("side", tr("右侧边栏"))
          .setValue(this.plugin.settings.openInMainArea ? "main" : "side")
          .onChange(async (v) => {
            this.plugin.settings.openInMainArea = v === "main";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("交易笔记目录"))
      .setDesc(tr("交易记录会以 Markdown 形式保存在 vault 的这个目录下"))
      .addText((t) =>
        t
          .setPlaceholder("Trading")
          .setValue(this.plugin.settings.folder)
          .onChange(async (v) => {
            this.plugin.settings.folder = v.trim() || "Trading";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(tr("货币符号"))
      .setDesc(tr("显示盈亏时使用的前缀，例如 ¥ 或 $"))
      .addText((t) =>
        t
          .setPlaceholder("¥")
          .setValue(this.plugin.settings.currency)
          .onChange(async (v) => {
            this.plugin.settings.currency = v.trim() || "¥";
            await this.plugin.saveSettings();
            this.plugin.reloadViews();
          })
      );

    new Setting(containerEl)
      .setName(tr("打平区间"))
      .setDesc(
        tr("单笔盈亏落在这个范围内算打平，不计入胜率、也不打断连胜连亏。填 0 表示只有刚好 0 才算平。") +
          tr("期货建议填 1–2 个最小跳动乘合约乘数（MNQ 约 10，MES 约 6），把手续费级别的噪音挡掉。")
      )
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.breakEven || 0))
          .onChange(async (v) => {
            const n = Number(v.replace(/[^0-9.]/g, ""));
            this.plugin.settings.breakEven = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
            this.plugin.reloadViews();
          })
      );

    new Setting(containerEl)
      .setName(tr("数据说明"))
      .setDesc(
        tr("每笔交易是目录里的一个 .md 文件，字段存在 frontmatter，正文是你的复盘笔记。可以直接在 Obsidian 里编辑，也可以同步/备份。")
      );
  }
}
