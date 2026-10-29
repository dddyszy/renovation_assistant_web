// Explicit, development-only sample data. Never runs on application startup.
export {};
const root = process.env.DEMO_URL || "http://localhost:5173";
let cookie = "";
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${root}/api/v1${path}`, {
    method,
    headers: {
      origin: root,
      "x-requested-with": "zhu-jia-web",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await response.json()) as any;
  if (!response.ok) throw new Error(json.error?.message || "请求失败");
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  return json.data;
}
const health = await api("/health");
if (process.env.NODE_ENV === "production" || !health.localMail)
  throw new Error("演示数据只允许写入未配置邮件的本地开发环境");
const email = "demo@example.test",
  password = "ZhuJiaDemo!2026";
try {
  await api("/auth/login", "POST", { email, password });
} catch {
  await api("/auth/register", "POST", {
    email,
    password,
    nickname: "小林",
  });
  await api("/auth/login", "POST", { email, password });
}
const families = await api("/families");
if (families.length) {
  console.log("演示账号已有家庭，保留现有数据。");
  process.exit(0);
}
const family = await api("/families", "POST", { name: "林家的小日子" });
const project = await api(`/families/${family.id}/projects`, "POST", {
  name: "云栖 · 我们的新家",
  packageType: "half",
  budgetCents: 30000000,
  templateId: "half-standard",
  address: "演示项目 · 云栖花园",
  startDate: "2026-09-01",
  endDate: "2027-01-15",
  description: "这是用于体验功能的虚构演示数据，可自由修改。",
});
const base = `/families/${family.id}/projects/${project.id}`;
const stages = await api(base + "/stages");
for (const [i, s] of stages.entries())
  await api(base + `/stages/${s.id}`, "PATCH", {
    version: s.version,
    budgetCents: [
      1500000, 2000000, 5000000, 6000000, 3500000, 2500000, 4000000, 3500000,
      500000,
    ][i],
    status:
      i < 2 ? "completed" : i === 2 || i === 3 ? "in_progress" : "pending",
  });
const materials = [
  {
    name: "客厅哑光地砖",
    category: "材料",
    stageId: stages[3].id,
    quantity: 68,
    unit: "㎡",
    model: "800 × 800 · 奶油白",
    supplier: "马可波罗瓷砖",
    totalPriceCents: 1680000,
    purchaseStatus: "ordered",
  },
  {
    name: "全屋水电材料",
    category: "材料",
    stageId: stages[2].id,
    quantity: 1,
    unit: "套",
    model: "阻燃电线 · PPR 水管",
    supplier: "水电施工方",
    totalPriceCents: 1250000,
    purchaseStatus: "purchased",
  },
  {
    name: "厨房定制橱柜",
    category: "家具",
    stageId: stages[6].id,
    quantity: 4.5,
    unit: "延米",
    model: "浅橡木 · 石英石台面",
    supplier: "本地定制工作室",
    totalPriceCents: 2280000,
    purchaseStatus: "planned",
  },
  {
    name: "主卧木地板",
    category: "材料",
    stageId: stages[6].id,
    quantity: 35,
    unit: "㎡",
    model: "三层实木 · 原木色",
    supplier: "圣象地板",
    totalPriceCents: 980000,
    purchaseStatus: "planned",
  },
];
const saved = [];
for (const m of materials)
  saved.push(await api(base + "/materials", "POST", m));
const costs = [
  {
    title: "装修设计费",
    category: "设计",
    amountCents: 1500000,
    stageId: stages[0].id,
    paymentStatus: "paid",
    merchant: "拾间设计",
    incurredAt: "2026-09-03",
  },
  {
    title: "拆除与垃圾清运",
    category: "人工",
    amountCents: 1800000,
    stageId: stages[1].id,
    paymentStatus: "paid",
    merchant: "施工队",
    incurredAt: "2026-09-16",
  },
  {
    title: "水电材料采购",
    category: "材料",
    amountCents: 1250000,
    stageId: stages[2].id,
    materialId: saved[1].id,
    paymentStatus: "paid",
    merchant: "水电施工方",
    incurredAt: "2026-10-08",
  },
  {
    title: "水电施工首期款",
    category: "人工",
    amountCents: 950000,
    stageId: stages[2].id,
    paymentStatus: "paid",
    merchant: "王师傅",
    incurredAt: "2026-10-19",
  },
  {
    title: "客厅地砖定金",
    category: "材料",
    amountCents: 500000,
    stageId: stages[3].id,
    materialId: saved[0].id,
    paymentStatus: "paid",
    merchant: "马可波罗瓷砖",
    incurredAt: "2026-10-27",
  },
  {
    title: "地砖尾款",
    category: "材料",
    amountCents: 1180000,
    stageId: stages[3].id,
    materialId: saved[0].id,
    paymentStatus: "pending",
    merchant: "马可波罗瓷砖",
    incurredAt: "2026-10-28",
  },
  {
    title: "水电验收与尾款",
    category: "人工",
    amountCents: 680000,
    stageId: stages[2].id,
    paymentStatus: "pending",
    merchant: "王师傅",
    incurredAt: "2026-10-29",
  },
];
for (const c of costs)
  await api(base + "/costs", "POST", { ...c, requestId: crypto.randomUUID() });
const cols = await api(base + "/note-columns");
await api(base + "/notes/import", "POST", {
  items: [
    {
      title: "和物业确认装修时间",
      columnId: cols[0].id,
      details: ["周末是否可以施工", "提前办理装修押金与出入证"],
      status: "confirmed",
    },
    {
      title: "厨房插座位置再确认",
      columnId: cols[0].id,
      details: [
        "洗碗机、咖啡机各留一个独立插座",
        "台面插座高度与橱柜方案一起核对",
      ],
      starred: true,
    },
    {
      title: "水电验收请家人一起到场",
      columnId: cols[0].id,
      details: ["保留管线照片，方便后续安装", "确认漏保、打压测试结果"],
      starred: true,
    },
    {
      title: "玄关留一个随手放钥匙的位置",
      columnId: cols[1].id,
      details: ["下方留扫地机器人回充空间"],
    },
    {
      title: "客厅想要一盏温暖的落地灯",
      columnId: cols[2].id,
      details: ["色温 2700K–3000K", "和沙发位置一起考虑"],
    },
  ],
});
console.log(
  "本地演示数据已创建。账号 demo@example.test，密码 ZhuJiaDemo!2026。",
);
