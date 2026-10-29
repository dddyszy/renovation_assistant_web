export const templates = [
  {
    id: "half-standard",
    type: "half",
    name: "常规施工",
    description: "自己买主材，按工序细细记录",
    stages: [
      "前期准备",
      "拆除改造",
      "水电工程",
      "泥瓦工程",
      "木工工程",
      "油漆工程",
      "安装工程",
      "软装入住",
      "验收交付",
    ],
  },
  {
    id: "half-partial",
    type: "half",
    name: "局部翻新",
    description: "厨房、卫生间等局部改造",
    stages: [
      "方案设计",
      "拆除改造",
      "水电防水",
      "泥瓦铺贴",
      "安装收尾",
      "验收交付",
    ],
  },
  {
    id: "full-standard",
    type: "full",
    name: "标准全包",
    description: "工程款、增项和自购分开记",
    stages: [
      "设计签约",
      "装修公司施工",
      "增项变更",
      "自购主材家电",
      "软装入住",
      "验收交付",
    ],
  },
  {
    id: "blank",
    type: "any",
    name: "空白流程",
    description: "从自己的装修节奏开始",
    stages: [],
  },
] as const;
export const categories = {
  half: ["材料", "人工", "设计", "家具", "家电", "其他"],
  full: ["工程款", "增项", "自购材料", "设计", "家具", "家电", "其他"],
};
export const roles: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  viewer: "只读成员",
};
export const stageLabels: Record<string, string> = {
  pending: "未开始",
  in_progress: "进行中",
  completed: "已完成",
};
export const purchaseLabels: Record<string, string> = {
  planned: "待采购",
  ordered: "已下单",
  purchased: "已购入",
};
export function toCents(value: string | number): number {
  const str = String(value).trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(str))
    throw new Error("请输入有效金额，最多两位小数");
  const [whole, fraction = ""] = str.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 999_999_999_999)
    throw new Error("金额超出范围");
  return amount;
}
export function money(value: number | string = 0) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(value) / 100);
}
export function dateText(value: string) {
  return value ? value.slice(0, 10).replaceAll("-", ".") : "—";
}
export function parseNotes(text: string) {
  return text
    .split(/\r?\n/)
    .filter((s) => s.trim())
    .slice(0, 100)
    .map((line) => {
      const starred =
        /^[\s★☆⭐🌟*＊]+/u.test(line) &&
        Boolean(line.match(/^[\s★☆⭐🌟*＊]+/u)?.[0].trim());
      const clean = line
        .trim()
        .replace(/^[\s★☆⭐🌟*＊]+/u, "")
        .replace(/^(?:[-–—·•]\s*|\d{1,3}[.、)）]\s*)/, "");
      const match = clean.match(/^(.+?)[（(](.*?)[）)]?$/);
      return {
        title: (match?.[1] || clean).slice(0, 60),
        details: match
          ? match[2]
              .split(/[，,；;、]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 20)
              .map((s) => s.slice(0, 200))
          : [],
        starred,
        status: "pending" as const,
      };
    })
    .filter((n) => n.title);
}
