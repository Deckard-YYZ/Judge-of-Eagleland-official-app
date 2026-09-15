export const themeTokenNames = [
  "canvas",
  "surface",
  "surfaceRaised",
  "ink",
  "muted",
  "line",
  "emphasis",
  "inverse",
  "quiet",
  "focus",
] as const;

export type ThemeMode = "light" | "dark";
export type ThemeTokenName = (typeof themeTokenNames)[number];
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;

export interface ThemeCandidate {
  readonly id: string;
  readonly sequence: string;
  readonly name: string;
  readonly englishName: string;
  readonly thesis: string;
  readonly keywords: readonly [string, string, string];
  readonly influence: string;
  readonly tradeoff: string;
  readonly typography: {
    readonly display: string;
    readonly body: string;
    readonly mono: string;
  };
  readonly shape: {
    readonly radius: string;
    readonly shadow: string;
    readonly lineWidth: string;
  };
  readonly modes: Readonly<Record<ThemeMode, ThemeTokens>>;
}

const systemSans = 'Inter, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const systemMono = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';

/**
 * Theme Lab is deliberately pure data: no candidate imports production UI, content,
 * or game state. Keeping the visual vocabulary here makes comparison deterministic.
 */
export const themeCandidates: readonly ThemeCandidate[] = [
  {
    id: "exactitude",
    sequence: "01",
    name: "绝对刻度",
    englishName: "Exactitude",
    thesis: "以编号、阈值与审计线取代装饰；每一项判断都像已被登记、核验并等待签发。",
    keywords: ["审计刻度", "命令编号", "数字监视"],
    influence: "用重复的计量线、状态码与紧凑网格，制造不容偏差的程序压力。",
    tradeoff: "信息密度和执行感最强；严密的规则语法会压缩叙事的呼吸空间。",
    typography: { display: systemSans, body: systemSans, mono: systemMono },
    shape: { radius: "0", shadow: "none", lineWidth: "1px" },
    modes: {
      light: {
        canvas: "#f4f4f2",
        surface: "#ffffff",
        surfaceRaised: "#e9e9e6",
        ink: "#0a0b0c",
        muted: "#626467",
        line: "#d1d2cf",
        emphasis: "#111214",
        inverse: "#fafaf8",
        quiet: "#eeeeeb",
        focus: "#34373a",
      },
      dark: {
        canvas: "#08090a",
        surface: "#0f1011",
        surfaceRaised: "#181a1c",
        ink: "#f3f3f0",
        muted: "#999c9f",
        line: "#2b2d30",
        emphasis: "#ffffff",
        inverse: "#08090a",
        quiet: "#141517",
        focus: "#d9dbdc",
      },
    },
  },
  {
    id: "monument",
    sequence: "02",
    name: "纪碑留白",
    englishName: "Monument",
    thesis: "让中轴、留白与厚重边界主持秩序；裁定不是被强调的口号，而是被制度围拢的仪式。",
    keywords: ["中央轴线", "结构留白", "仪式边界"],
    influence: "以巨大的结构比例、克制的黑色体块和缓慢的阅读节奏暗示单一权力中心。",
    tradeoff: "仪式感最强、长文最安静；同屏操作信息更少，适合需要郑重停顿的关键裁定。",
    typography: { display: systemSans, body: systemSans, mono: systemMono },
    shape: { radius: "0", shadow: "0 28px 80px rgba(0, 0, 0, 0.12)", lineWidth: "1px" },
    modes: {
      light: {
        canvas: "#f2f2ef",
        surface: "#fafaf8",
        surfaceRaised: "#e6e6e2",
        ink: "#151515",
        muted: "#6b6b68",
        line: "#ccccca",
        emphasis: "#000000",
        inverse: "#ffffff",
        quiet: "#eeeeeb",
        focus: "#333333",
      },
      dark: {
        canvas: "#000000",
        surface: "#080808",
        surfaceRaised: "#141414",
        ink: "#f5f5f2",
        muted: "#999997",
        line: "#292929",
        emphasis: "#ffffff",
        inverse: "#000000",
        quiet: "#0f0f0f",
        focus: "#dadad7",
      },
    },
  },
] as const;
