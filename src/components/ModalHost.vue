<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import {
  X,
  Plus,
  Trash2,
  Archive,
  RotateCcw,
  Copy,
  ArrowLeft,
  Wallet,
  Package,
  NotebookPen,
} from "@lucide/vue";
import { useWorkspace, type Item } from "../workspace";
import { request } from "../api";
import {
  templates,
  categories,
  toCents,
  parseNotes,
  money,
} from "../../shared/domain";
import { useProjectQuery } from "../queries";
const w = useWorkspace(),
  client = useQueryClient(),
  form = ref<Item>({}),
  busy = ref(false),
  error = ref(""),
  keepAdding = ref(false),
  localMessage = ref(""),
  panel = ref<HTMLElement>(),
  deleteConfirm = ref(false);
const stages = useProjectQuery("stages"),
  columns = useProjectQuery("note-columns");
const materials = ref<Item[]>([]),
  requestId = ref(""),
  priorFocus = ref<HTMLElement>();
const title = computed(
  () =>
    (
      ({
        family: "创建你的家庭",
        familyRename: "修改家庭名称",
        project: w.editing ? "编辑装修项目" : "开启一个装修计划",
        cost: w.editing?.id
          ? w.canWrite
            ? "编辑这笔支出"
            : "查看这笔支出"
          : "记下家的这一笔",
        material: w.editing?.id
          ? w.canWrite
            ? "编辑材料计划"
            : "查看材料计划"
          : "添加材料计划",
        note: w.editing?.id
          ? w.canWrite
            ? "编辑装修备忘"
            : "查看装修备忘"
          : "记录一个家的想法",
        column: w.editing ? "修改专栏" : "新建备忘专栏",
        stage: w.editing ? "阶段设置" : "添加装修阶段",
        projects: "我们的装修项目",
        import: "把清单变成备忘",
        destroyProject: "永久删除装修项目",
        dissolveFamily: "解散家庭",
      }) as Record<string, string>
    )[w.modal] || "",
);
const draftKey = computed(() => `draft:cost:${w.user?.id}:${w.fid}:${w.pid}`);
const importPreview = computed(() => parseNotes(form.value.content || ""));
const writable = computed(
  () =>
    !w.editing?.id ||
    w.canWrite ||
    (["project", "stage"].includes(w.modal) && w.isAdmin) ||
    (["destroyProject", "dissolveFamily"].includes(w.modal) &&
      w.family?.role === "owner"),
);
const availableMaterials = computed(() =>
  materials.value.filter(
    (m) => !form.value.stageId || m.stageId === form.value.stageId,
  ),
);
const templateOptions = computed(() =>
  templates.filter(
    (t) => t.type === "any" || t.type === form.value.packageType,
  ),
);
function resetCost() {
  form.value = {
    title: "",
    amount: "",
    category:
      categories[w.project?.packageType === "full" ? "full" : "half"][0],
    stageId:
      localStorage.getItem(`stage:${w.user?.id}:${w.pid}`) ||
      stages.data.value?.data?.find((s: any) => s.status === "in_progress")
        ?.id ||
      "",
    materialId: "",
    paymentStatus: "pending",
    merchant: "",
    paymentMethod: "",
    note: "",
    incurredAt: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  };
  requestId.value = crypto.randomUUID();
}
watch(
  () => w.modal,
  async (type) => {
    error.value = "";
    deleteConfirm.value = false;
    localMessage.value = "";
    busy.value = false;
    if (!type) return;
    priorFocus.value = document.activeElement as HTMLElement;
    const e = w.editing;
    if (type === "cost") {
      resetCost();
      if (e)
        form.value = {
          ...e,
          amount: e.amountCents ? String(e.amountCents / 100) : "",
          stageId: e.stageId || "",
          materialId: e.materialId || "",
        };
      else
        try {
          const draft = JSON.parse(
            localStorage.getItem(draftKey.value) || "null",
          );
          if (draft) {
            form.value = draft.form;
            requestId.value = draft.requestId || requestId.value;
            localMessage.value = "已恢复上次未完成的草稿";
          }
        } catch {}
      try {
        let page = 1;
        const all: Item[] = [];
        while (true) {
          const result = await request(
            `${w.base}/materials?pageSize=100&page=${page}`,
          );
          all.push(...result.data);
          if (all.length >= result.meta.total) break;
          page++;
        }
        materials.value = all;
      } catch (e: any) {
        error.value = e.message;
      }
    } else if (type === "project")
      form.value = e
        ? { ...e, budget: String(e.budgetCents / 100) }
        : {
            name: "",
            address: "",
            description: "",
            packageType: "half",
            templateId: "half-standard",
            budget: "",
            startDate: "",
            endDate: "",
            contract: "",
          };
    else if (type === "material")
      form.value = e
        ? {
            ...e,
            amount: String(e.totalPriceCents / 100),
            stageId: e.stageId || "",
          }
        : {
            name: "",
            category: "材料",
            stageId: "",
            quantity: 1,
            unit: "件",
            model: "",
            supplier: "",
            note: "",
            amount: "",
            purchaseStatus: "planned",
          };
    else if (type === "note")
      form.value = e
        ? { ...e, detailText: (e.details || []).join("\n") }
        : {
            title: "",
            columnId: columns.data.value?.data?.[0]?.id || "",
            detailText: "",
            starred: false,
            status: "pending",
          };
    else if (type === "stage")
      form.value = e
        ? { ...e, budget: String(e.budgetCents / 100) }
        : { name: "", budget: "", status: "pending" };
    else if (type === "column") form.value = e ? { ...e } : { name: "" };
    else if (type === "import")
      form.value = {
        content: "",
        columnId: e?.columnId || columns.data.value?.data?.[0]?.id || "",
      };
    else if (type === "familyRename")
      form.value = { name: w.family?.name || "" };
    else form.value = { name: "" };
    await nextTick();
    panel.value
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      ?.focus();
  },
);
watch(
  () => form.value.packageType,
  () => {
    if (w.modal === "project" && !w.editing?.id)
      form.value.templateId =
        form.value.packageType === "full" ? "full-standard" : "half-standard";
  },
);
watch(
  form,
  () => {
    if (w.modal === "cost" && !w.editing?.id && form.value.title !== undefined)
      localStorage.setItem(
        draftKey.value,
        JSON.stringify({ form: form.value, requestId: requestId.value }),
      );
  },
  { deep: true },
);
function close() {
  if (busy.value) return;
  w.close();
  priorFocus.value?.focus();
}
function keyboard(e: KeyboardEvent) {
  if (!w.modal) return;
  if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
  if (e.key === "Tab") {
    const els = panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),a,input,select,textarea,[tabindex="0"]',
    );
    if (!els?.length) return;
    const first = els[0]!,
      last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
onMounted(() => document.addEventListener("keydown", keyboard));
onUnmounted(() => document.removeEventListener("keydown", keyboard));
async function refresh() {
  await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
  await client.invalidateQueries({ queryKey: ["family"] });
}
async function save() {
  busy.value = true;
  error.value = "";
  try {
    const f = form.value,
      e = w.editing?.id ? w.editing : null,
      type = w.modal;
    if (type === "destroyProject") {
      await request(w.base, "DELETE", {
        confirmName: f.confirmName,
        password: f.password,
        version: e!.version,
      });
      await w.loadProjects();
    } else if (type === "dissolveFamily") {
      await request(`/families/${w.fid}`, "DELETE", {
        confirmName: f.confirmName,
        password: f.password,
      });
      w.fid = "";
      await w.loadFamilies();
      client.clear();
    } else if (type === "family") {
      const { data } = await request("/families", "POST", { name: f.name });
      w.fid = data.id;
      await w.loadFamilies();
    } else if (type === "familyRename") {
      await request(`/families/${w.fid}`, "PATCH", { name: f.name });
      await w.loadFamilies();
    } else if (type === "project") {
      const payload = {
        name: f.name,
        address: f.address || "",
        description: f.description || "",
        budgetCents: toCents(f.budget || "0"),
        packageType: f.packageType,
        templateId: f.templateId,
        contractCents: toCents(f.contract || "0"),
        startDate: f.startDate || "",
        endDate: f.endDate || "",
        ...(e ? { version: e.version } : {}),
      };
      const { data } = await request(
        e ? w.base : `/families/${w.fid}/projects`,
        e ? "PATCH" : "POST",
        payload,
      );
      await w.loadProjects();
      w.pid = data.id;
    } else if (type === "import") {
      if (!importPreview.value.length) throw new Error("请先粘贴清单");
      await request(`${w.base}/notes/import`, "POST", {
        items: importPreview.value.map((i) => ({ ...i, columnId: f.columnId })),
      });
    } else {
      let resource = "",
        payload: Item = {};
      if (type === "cost") {
        resource = "costs";
        payload = {
          ...f,
          amountCents: toCents(f.amount),
          stageId: f.stageId || null,
          materialId: f.materialId || null,
          requestId: requestId.value,
        };
        if (payload.amountCents <= 0) throw new Error("支出金额必须大于零");
      }
      if (type === "material") {
        resource = "materials";
        payload = {
          ...f,
          quantity: Number(f.quantity),
          totalPriceCents: toCents(f.amount || "0"),
          stageId: f.stageId || null,
        };
      }
      if (type === "note") {
        resource = "notes";
        payload = {
          ...f,
          details: String(f.detailText || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      }
      if (type === "column") {
        resource = "note-columns";
        payload = { name: f.name };
      }
      if (type === "stage") {
        resource = "stages";
        payload = {
          name: f.name,
          budgetCents: toCents(f.budget || "0"),
          ...(e ? { status: f.status } : {}),
        };
      }
      if (e) payload.version = e.version;
      await request(
        `${w.base}/${resource}${e ? `/${e.id}` : ""}`,
        e ? "PATCH" : "POST",
        payload,
      );
      if (type === "cost") {
        localStorage.removeItem(draftKey.value);
        if (f.stageId)
          localStorage.setItem(`stage:${w.user?.id}:${w.pid}`, f.stageId);
      }
    }
    await refresh();
    w.notify(w.editing?.id ? "修改已保存" : "已保存到家庭手记");
    if (type === "cost" && keepAdding.value && !e) {
      resetCost();
      localMessage.value = "上一笔已保存，可以继续记录";
      await nextTick();
      panel.value?.querySelector<HTMLInputElement>("input")?.focus();
    } else w.close();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function remove() {
  if (!deleteConfirm.value) {
    deleteConfirm.value = true;
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const map: Record<string, string> = {
      cost: "costs",
      material: "materials",
      note: "notes",
      stage: "stages",
      column: "note-columns",
    };
    const path = `${w.base}/${map[w.modal]}/${w.editing!.id}`;
    const { data } = await request(path, "DELETE", {
      version: w.editing!.version,
    });
    await refresh();
    w.notify("记录已删除", async () => {
      try {
        await request(path + "/restore", "POST", { version: data.version });
        await refresh();
        w.notify("记录已恢复");
      } catch (e: any) {
        w.notify(e.message);
      }
    });
    w.close();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function archive(p: Item) {
  busy.value = true;
  error.value = "";
  try {
    await request(`/families/${w.fid}/projects/${p.id}/archive`, "POST", {
      version: p.version,
      archived: p.status !== "archived",
    });
    await w.loadProjects();
    await refresh();
    w.notify(p.status === "archived" ? "项目已恢复" : "项目已归档");
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function editProject(p: Item, type = "project") {
  w.pid = p.id;
  await nextTick();
  w.open(type, p);
}
function selectMaterial() {
  const m = materials.value.find((m) => m.id === form.value.materialId);
  if (m) {
    form.value.stageId = m.stageId || "";
    if (!form.value.title) form.value.title = m.name;
    if (!form.value.merchant) form.value.merchant = m.supplier;
  }
}
function copyPrevious() {
  const previous = client.getQueryData<any>([
    "project",
    w.fid,
    w.pid,
    "statistics",
  ])?.data?.recent?.[0];
  if (previous) {
    form.value = {
      ...form.value,
      title: previous.title,
      category: previous.category,
      stageId: previous.stageId || "",
      merchant: previous.merchant,
      paymentMethod: previous.paymentMethod,
      amount: String(previous.amountCents / 100),
    };
    localMessage.value = "已带入上一笔，请核对金额、日期与支付状态";
  } else localMessage.value = "暂无上一笔记录";
}
</script>
<template>
  <Teleport to="body"
    ><div v-if="w.modal" class="modal-backdrop" @click.self="close">
      <section
        ref="panel"
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header class="modal-header">
          <div>
            <span class="eyebrow"
              >筑家手记 · {{ w.family?.name || "OUR HOME" }}</span
            >
            <h2 id="modal-title">{{ title }}</h2>
          </div>
          <button
            class="icon-btn"
            aria-label="关闭"
            @click="close"
            :disabled="busy"
          >
            <X :size="22" />
          </button>
        </header>
        <div v-if="error" class="error-box" role="alert">{{ error }}</div>
        <template v-if="w.modal === 'projects'"
          ><div class="project-management">
            <div
              v-for="p in w.projects"
              :key="p.id"
              class="project-management-row"
            >
              <div>
                <strong>{{ p.name }}</strong
                ><small
                  >{{ p.packageType === "full" ? "全包" : "半包" }} ·
                  {{ money(p.budgetCents) }} ·
                  {{ p.status === "archived" ? "已归档" : "进行中" }}</small
                >
              </div>
              <div class="inline-actions">
                <button
                  v-if="p.status === 'archived' && w.family?.role === 'owner'"
                  class="text-btn danger"
                  @click="editProject(p, 'destroyProject')"
                >
                  永久删除</button
                ><button
                  class="text-btn"
                  @click="
                    w.pid = p.id;
                    close();
                  "
                >
                  切换</button
                ><button
                  v-if="p.status !== 'archived'"
                  class="text-btn"
                  @click="editProject(p)"
                >
                  编辑</button
                ><button
                  class="icon-btn"
                  :aria-label="
                    p.status === 'archived' ? '恢复项目' : '归档项目'
                  "
                  :disabled="busy"
                  @click="archive(p)"
                >
                  <RotateCcw
                    v-if="p.status === 'archived'"
                    :size="17"
                  /><Archive v-else :size="17" />
                </button>
              </div>
            </div>
            <button class="btn primary" @click="w.open('project')">
              <Plus :size="18" />新建装修项目
            </button>
          </div></template
        >
        <form v-else @submit.prevent="save">
          <fieldset :disabled="!writable" class="form-fieldset">
            <div v-if="localMessage" class="info-box">{{ localMessage }}</div>
            <template
              v-if="['destroyProject', 'dissolveFamily'].includes(w.modal)"
              ><div class="error-box">
                {{
                  w.modal === "destroyProject"
                    ? "这会永久删除该项目及其全部材料、支出和备忘，无法撤销。"
                    : "这会永久删除家庭内的全部装修项目与记录，所有家人都将失去访问权，无法撤销。"
                }}
              </div>
              <label class="field"
                >输入完整{{
                  w.modal === "destroyProject" ? "项目" : "家庭"
                }}名称确认<input
                  v-model="form.confirmName"
                  :placeholder="
                    w.modal === 'destroyProject'
                      ? w.editing?.name
                      : w.family?.name
                  "
                  required /></label
              ><label class="field"
                >你的登录密码<input
                  v-model="form.password"
                  type="password"
                  autocomplete="current-password"
                  required /></label></template
            ><template v-if="['family', 'familyRename'].includes(w.modal)"
              ><p class="muted">给家起一个名字，邀请家人一起记录装修的点滴。</p>
              <label class="field"
                >家庭名称<input
                  v-model="form.name"
                  placeholder="例如：林家的新家"
                  required
                  maxlength="40" /></label
            ></template>
            <template v-if="w.modal === 'project'"
              ><label class="field"
                >项目名称<input
                  v-model="form.name"
                  placeholder="例如：我们的第一套小家"
                  required
                  maxlength="60"
              /></label>
              <div v-if="!w.editing?.id" class="field">
                承包方式
                <div class="choice-grid">
                  <button
                    v-for="type in ['half', 'full']"
                    :key="type"
                    type="button"
                    :class="[
                      'choice-card',
                      { selected: form.packageType === type },
                    ]"
                    @click="form.packageType = type"
                  >
                    <strong>{{
                      type === "half" ? "半包装修" : "全包装修"
                    }}</strong
                    ><small>{{
                      type === "half"
                        ? "自己采购主材，细记每一阶段"
                        : "按付款节点，记录工程与增项"
                    }}</small>
                  </button>
                </div>
              </div>
              <div v-if="!w.editing?.id" class="field">
                装修流程
                <div class="template-grid">
                  <button
                    v-for="t in templateOptions"
                    :key="t.id"
                    type="button"
                    :class="[
                      'template-option',
                      { selected: form.templateId === t.id },
                    ]"
                    @click="form.templateId = t.id"
                  >
                    <strong>{{ t.name }}</strong
                    ><small>{{ t.description }}</small>
                  </button>
                </div>
                <small class="field-help">{{
                  templates
                    .find((t) => t.id === form.templateId)
                    ?.stages.join(" → ") || "创建后自由添加装修阶段"
                }}</small>
              </div>
              <div class="form-grid">
                <label class="field"
                  >装修总预算（元）<input
                    v-model="form.budget"
                    inputmode="decimal"
                    placeholder="200000.00" /></label
                ><label
                  v-if="form.packageType === 'full' && !w.editing?.id"
                  class="field"
                  >装修合同金额（元）<input
                    v-model="form.contract"
                    inputmode="decimal"
                    placeholder="填入施工阶段预算"
                /></label>
              </div>
              <label class="field"
                >房屋地址 <span class="optional">选填</span
                ><input
                  v-model="form.address"
                  placeholder="例如：朝阳区 · 云栖花园"
                  maxlength="200"
              /></label>
              <div class="form-grid">
                <label class="field"
                  >计划开工<input v-model="form.startDate" type="date" /></label
                ><label class="field"
                  >计划完工<input v-model="form.endDate" type="date"
                /></label>
              </div>
              <label class="field"
                >项目备注<textarea
                  v-model="form.description"
                  rows="2"
                  maxlength="500"
                  placeholder="对这个家，有什么期待？"
                /></label
            ></template>
            <template v-if="w.modal === 'cost'"
              ><div class="record-type">
                <span><Wallet :size="18" />实际支出</span
                ><button
                  v-if="!w.editing?.id"
                  type="button"
                  class="text-btn"
                  @click="w.open('material')"
                >
                  <Package :size="16" />改记材料计划
                </button>
              </div>
              <div class="amount-input">
                <label for="cost-amount">支出金额</label>
                <div>
                  <span>¥</span
                  ><input
                    id="cost-amount"
                    v-model="form.amount"
                    inputmode="decimal"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <label class="field"
                >这笔钱花在哪里？<input
                  v-model="form.title"
                  placeholder="例如：厨房瓷砖定金"
                  required
                  maxlength="100"
              /></label>
              <div class="form-grid">
                <label class="field"
                  >所属阶段<select
                    v-model="form.stageId"
                    @change="form.materialId = ''"
                  >
                    <option value="">不指定阶段</option>
                    <option
                      v-for="s in stages.data.value?.data || []"
                      :key="s.id"
                      :value="s.id"
                    >
                      {{ s.name }}
                    </option>
                  </select></label
                ><label class="field"
                  >费用分类<select v-model="form.category">
                    <option
                      v-for="c in categories[
                        w.project?.packageType === 'full' ? 'full' : 'half'
                      ]"
                      :key="c"
                    >
                      {{ c }}
                    </option>
                  </select></label
                >
              </div>
              <div class="field">
                支付状态
                <div class="segmented">
                  <button
                    type="button"
                    :class="{ selected: form.paymentStatus === 'pending' }"
                    @click="form.paymentStatus = 'pending'"
                  >
                    待支付</button
                  ><button
                    type="button"
                    :class="{ selected: form.paymentStatus === 'paid' }"
                    @click="form.paymentStatus = 'paid'"
                  >
                    已支付
                  </button>
                </div>
              </div>
              <label class="field"
                >记账日期<input v-model="form.incurredAt" type="date" required
              /></label>
              <details class="form-details" :open="!!w.editing?.id">
                <summary>商家、材料关联与更多信息</summary>
                <label class="field"
                  >关联材料<select
                    v-model="form.materialId"
                    @change="selectMaterial"
                  >
                    <option value="">不关联材料</option>
                    <option
                      v-for="m in availableMaterials"
                      :key="m.id"
                      :value="m.id"
                    >
                      {{ m.name }}
                    </option>
                  </select></label
                >
                <div class="form-grid">
                  <label class="field"
                    >商家<input
                      v-model="form.merchant"
                      placeholder="商家或施工方"
                      maxlength="100" /></label
                  ><label class="field"
                    >支付方式<select v-model="form.paymentMethod">
                      <option value="">未指定</option>
                      <option>微信支付</option>
                      <option>支付宝</option>
                      <option>银行卡</option>
                      <option>现金</option>
                      <option>其他</option>
                    </select></label
                  >
                </div>
                <label class="field"
                  >备注<textarea
                    v-model="form.note"
                    rows="2"
                    maxlength="1000"
                  />
                </label>
              </details>
              <div v-if="!w.editing?.id" class="form-extras">
                <button type="button" class="text-btn" @click="copyPrevious">
                  <Copy :size="15" />复制上一笔</button
                ><label class="checkbox-line"
                  ><input
                    v-model="keepAdding"
                    type="checkbox"
                  />保存后继续记</label
                >
              </div>
              <small class="muted"
                >材料计划与实际支出分开计算；待支付也计入已记总成本。</small
              ></template
            >
            <template v-if="w.modal === 'material'"
              ><label class="field"
                >材料名称<input
                  v-model="form.name"
                  placeholder="例如：客厅哑光地砖"
                  required
                  maxlength="100"
              /></label>
              <div class="form-grid">
                <label class="field"
                  >所属阶段<select v-model="form.stageId">
                    <option value="">不指定阶段</option>
                    <option
                      v-for="s in stages.data.value?.data || []"
                      :key="s.id"
                      :value="s.id"
                    >
                      {{ s.name }}
                    </option>
                  </select></label
                ><label class="field"
                  >材料分类<input
                    v-model="form.category"
                    required
                    maxlength="30"
                    placeholder="材料、家具、家电…"
                /></label>
              </div>
              <div class="form-grid">
                <label class="field"
                  >数量<input
                    v-model="form.quantity"
                    type="number"
                    min="0"
                    step="any"
                    required /></label
                ><label class="field"
                  >单位<input
                    v-model="form.unit"
                    maxlength="20"
                    placeholder="件 / ㎡ / 套"
                /></label>
              </div>
              <label class="field"
                >计划总金额（元）<input
                  v-model="form.amount"
                  inputmode="decimal"
                  placeholder="0.00"
              /></label>
              <div class="form-grid">
                <label class="field"
                  >型号<input v-model="form.model" maxlength="100" /></label
                ><label class="field"
                  >供应商<input v-model="form.supplier" maxlength="100"
                /></label>
              </div>
              <label class="field"
                >采购状态<select v-model="form.purchaseStatus">
                  <option value="planned">待采购</option>
                  <option value="ordered">已下单</option>
                  <option value="purchased">已购入</option>
                </select></label
              ><label class="field"
                >备注<textarea v-model="form.note" rows="2" maxlength="1000" />
              </label>
              <div v-if="w.editing" class="info-box">
                更改阶段会同步移动本材料的关联支出。
              </div></template
            >
            <template v-if="w.modal === 'note'"
              ><label class="field"
                >需求或想法<input
                  v-model="form.title"
                  required
                  maxlength="60"
                  placeholder="例如：厨房插座提前确认" /></label
              ><label class="field"
                >所属专栏<select v-model="form.columnId" required>
                  <option
                    v-for="c in columns.data.value?.data || []"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }}
                  </option>
                </select></label
              ><label class="field"
                >具体描述 <span class="optional">每行一条，最多 20 条</span
                ><textarea
                  v-model="form.detailText"
                  rows="5"
                  placeholder="咖啡机、洗碗机各留一个插座&#10;台面高度和家人确认"
                /></label
              ><label class="checkbox-line"
                ><input
                  v-model="form.starred"
                  type="checkbox"
                />标记为重点</label
              ><label class="field"
                >确认状态<select v-model="form.status">
                  <option value="pending">待确认</option>
                  <option value="confirmed">已确认</option>
                </select></label
              ></template
            >
            <template v-if="w.modal === 'column'"
              ><label class="field"
                >专栏名称<input
                  v-model="form.name"
                  required
                  maxlength="30"
                  placeholder="例如：软装采购清单" /></label
            ></template>
            <template v-if="w.modal === 'stage'"
              ><label class="field"
                >阶段名称<input
                  v-model="form.name"
                  required
                  maxlength="60" /></label
              ><label class="field"
                >阶段预算（元）<input
                  v-model="form.budget"
                  inputmode="decimal"
                  placeholder="0.00" /></label
              ><label v-if="w.editing" class="field"
                >施工状态<select v-model="form.status">
                  <option value="pending">未开始</option>
                  <option value="in_progress">进行中</option>
                  <option value="completed">已完成</option>
                </select></label
              ></template
            >
            <template v-if="w.modal === 'import'"
              ><label class="field"
                >导入到专栏<select v-model="form.columnId" required>
                  <option
                    v-for="c in columns.data.value?.data || []"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.name }}
                  </option>
                </select></label
              ><label class="field"
                >粘贴你的装修清单<textarea
                  v-model="form.content"
                  rows="7"
                  placeholder="每行一项；* 标为重点；括号里写具体描述&#10;* 厨房插座（洗碗机、咖啡机）&#10;阳台布局（洗烘机位置、手洗区）"
                  maxlength="30000"
                />
              </label>
              <div v-if="importPreview.length" class="import-preview">
                <strong>将导入 {{ importPreview.length }} 项</strong>
                <p v-for="(n, i) in importPreview" :key="i">
                  {{ n.starred ? "★ " : "" }}{{ n.title
                  }}<small v-if="n.details.length">{{
                    n.details.join(" · ")
                  }}</small>
                </p>
              </div></template
            >
          </fieldset>
          <footer class="modal-footer">
            <button
              v-if="
                w.editing?.id &&
                !['project', 'destroyProject'].includes(w.modal) &&
                writable
              "
              type="button"
              class="text-btn danger"
              :disabled="busy"
              @click="remove"
            >
              <Trash2 :size="16" />{{
                deleteConfirm ? "再次点击确认删除" : "删除"
              }}</button
            ><span v-else class="save-hint">{{
              w.modal === "cost" && !w.editing?.id
                ? "未提交内容会自动保存为本机草稿"
                : ""
            }}</span>
            <div class="inline-actions">
              <button
                type="button"
                class="btn secondary"
                @click="close"
                :disabled="busy"
              >
                取消</button
              ><button v-if="writable" class="btn primary" :disabled="busy">
                {{
                  busy
                    ? "正在保存…"
                    : w.modal === "import"
                      ? "确认导入"
                      : ["destroyProject", "dissolveFamily"].includes(w.modal)
                        ? "确认永久删除"
                        : "保存"
                }}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div></Teleport
  >
</template>
