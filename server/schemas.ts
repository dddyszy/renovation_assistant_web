import { z } from "zod";
export const text = (max = 200) => z.string().trim().max(max);
export const required = (max = 100) => text(max).min(1, "请填写必填内容");
export const cents = z.number().int().min(0).max(999_999_999_999);
export const version = z.number().int().positive();
export const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const password = z.string().min(10, "密码至少 10 位").max(128);
export const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确")
  .refine(
    (s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    "日期不存在",
  );
export const optionalDate = z.union([businessDate, z.literal("")]).default("");
export const projectSchema = z
  .object({
    name: required(60),
    address: text(200).default(""),
    description: text(500).default(""),
    packageType: z.enum(["half", "full"]),
    budgetCents: cents,
    startDate: optionalDate,
    endDate: optionalDate,
    templateId: z
      .enum(["half-standard", "half-partial", "full-standard", "blank"])
      .default("half-standard"),
    contractCents: cents.optional(),
  })
  .refine(
    (p) => !p.startDate || !p.endDate || p.endDate >= p.startDate,
    "结束日期不能早于开始日期",
  );
export const materialSchema = z.object({
  name: required(100),
  category: required(30),
  stageId: z.string().nullable().default(null),
  quantity: z.number().min(0).max(1e8).default(1),
  unit: text(20).default("件"),
  model: text(100).default(""),
  supplier: text(100).default(""),
  note: text(1000).default(""),
  totalPriceCents: cents,
  purchaseStatus: z.enum(["planned", "ordered", "purchased"]).default("planned"),
});
export const costSchema = z.object({
  title: required(100),
  category: required(30),
  amountCents: cents.refine((n) => n > 0, "金额必须大于零"),
  stageId: z.string().nullable().default(null),
  materialId: z.string().nullable().default(null),
  paymentStatus: z.enum(["paid", "pending"]).default("pending"),
  merchant: text(100).default(""),
  paymentMethod: text(30).default(""),
  note: text(1000).default(""),
  incurredAt: businessDate,
});
export const noteSchema = z.object({
  title: required(60),
  columnId: required(),
  details: z.array(text(200)).max(20).default([]),
  starred: z.boolean().default(false),
  status: z.enum(["pending", "confirmed"]).default("pending"),
});
