<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { Plus, Search, Package, ArrowUpRight, RotateCcw } from "@lucide/vue";
import { useWorkspace } from "../workspace";
import { request } from "../api";
import { useProjectQuery } from "../queries";
import { money, purchaseLabels } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
import EmptyState from "../components/EmptyState.vue";
const w = useWorkspace(),
  client = useQueryClient(),
  stage = ref(""),
  status = ref(""),
  keyword = ref(""),
  search = ref(""),
  page = ref(1),
  deleted = ref(false),
  error = ref("");
const stats = useProjectQuery("statistics"),
  stages = useProjectQuery("stages");
const params = computed(() =>
  new URLSearchParams({
    page: String(page.value),
    ...(stage.value ? { stageId: stage.value } : {}),
    ...(status.value ? { purchaseStatus: status.value } : {}),
    ...(keyword.value ? { keyword: keyword.value } : {}),
    ...(deleted.value ? { deleted: "true" } : {}),
  }).toString(),
);
const query = useQuery({
  enabled: computed(() => !!w.project),
  queryKey: computed(() => [
    "project",
    w.fid,
    w.pid,
    "materials-list",
    params.value,
  ]),
  queryFn: () => request(`${w.base}/materials?${params.value}`),
  refetchInterval: 30000,
});
function actual(id: string) {
  return (
    stats.data.value?.data?.byMaterial?.find(
      (m: any) => m.materialId === id,
    ) || { totalCents: 0, paidCents: 0, pendingCents: 0 }
  );
}
async function restore(m: any) {
  try {
    await request(`${w.base}/materials/${m.id}/restore`, "POST", {
      version: m.version,
    });
    await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
    w.notify("材料已恢复");
  } catch (e: any) {
    error.value = e.message;
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">THOUGHTFULLY CHOSEN</span>
      <h1>材料清单</h1>
      <p>为家挑选的每一件，都值得认真计划。</p>
    </div>
    <button v-if="w.canWrite" class="btn primary" @click="w.open('material')">
      <Plus :size="18" />添加材料
    </button>
  </div>
  <div class="mini-stats">
    <div>
      <span>材料计划金额</span
      ><strong>{{ money(stats.data.value?.data?.plannedCents || 0) }}</strong>
    </div>
    <div>
      <span>材料项目数</span
      ><strong
        >{{ stats.data.value?.data?.materialCount || 0
        }}<small> 件</small></strong
      >
    </div>
    <p>计划金额不直接计入总成本，<br />实际付款请通过「记一笔」关联材料。</p>
  </div>
  <div class="panel filter-panel">
    <form
      class="search-field"
      @submit.prevent="
        keyword = search;
        page = 1;
      "
    >
      <Search :size="18" /><input
        v-model="search"
        placeholder="搜索材料名称…"
        aria-label="搜索材料"
      /><button class="text-btn">搜索</button>
    </form>
    <div class="filter-row">
      <select v-model="stage" aria-label="筛选阶段" @change="page = 1">
        <option value="">全部阶段</option>
        <option
          v-for="s in stages.data.value?.data || []"
          :key="s.id"
          :value="s.id"
        >
          {{ s.name }}
        </option></select
      ><select v-model="status" aria-label="采购状态" @change="page = 1">
        <option value="">全部采购状态</option>
        <option
          v-for="(label, value) in purchaseLabels"
          :key="value"
          :value="value"
        >
          {{ label }}
        </option></select
      ><button
        class="text-btn"
        @click="
          deleted = !deleted;
          page = 1;
        "
      >
        <RotateCcw :size="14" />{{ deleted ? "返回材料清单" : "最近删除" }}
      </button>
    </div>
  </div>
  <div v-if="error" class="error-box">{{ error }}</div>
  <QueryState
    :loading="query.isPending.value"
    :error="query.error.value"
    @retry="query.refetch()"
  />
  <div class="material-grid">
    <article
      v-for="m in query.data.value?.data || []"
      :key="m.id"
      class="panel material-card"
    >
      <header>
        <span class="record-icon"
          ><Package :size="22" :stroke-width="1.5" /></span
        ><span
          :class="[
            'pill',
            m.purchaseStatus === 'purchased' ? 'green' : 'neutral',
          ]"
          >{{ purchaseLabels[m.purchaseStatus] }}</span
        >
      </header>
      <button
        class="material-name"
        :disabled="deleted"
        @click="w.open('material', m)"
      >
        {{ m.name }}<ArrowUpRight v-if="w.canWrite && !deleted" :size="17" />
      </button>
      <p class="muted small-text">
        {{
          stages.data.value?.data?.find((s: any) => s.id === m.stageId)?.name ||
          "未指定阶段"
        }}
        · {{ m.quantity }} {{ m.unit }}
      </p>
      <p v-if="m.model || m.supplier" class="material-meta">
        {{ [m.model, m.supplier].filter(Boolean).join(" · ") }}
      </p>
      <div class="material-amount">
        <span>计划金额</span><strong>{{ money(m.totalPriceCents) }}</strong>
      </div>
      <div class="material-amount">
        <span>已付 / 待付</span
        ><span
          >{{ money(actual(m.id).paidCents) }} /
          {{ money(actual(m.id).pendingCents) }}</span
        >
      </div>
      <div class="material-amount">
        <span>{{
          m.totalPriceCents < actual(m.id).totalCents ? "超出计划" : "计划余额"
        }}</span
        ><strong
          :class="{ danger: m.totalPriceCents < actual(m.id).totalCents }"
          >{{
            money(Math.abs(m.totalPriceCents - actual(m.id).totalCents))
          }}</strong
        >
      </div>
      <button
        v-if="deleted && w.canWrite"
        class="btn secondary small-btn"
        @click="restore(m)"
      >
        恢复材料</button
      ><button
        v-else-if="w.canWrite"
        class="text-btn material-payment"
        @click="
          w.open('cost', {
            title: m.name,
            amountCents: 0,
            category: m.category,
            stageId: m.stageId,
            materialId: m.id,
            paymentStatus: 'pending',
            merchant: m.supplier,
            paymentMethod: '',
            note: '',
            incurredAt: new Date().toISOString().slice(0, 10),
          })
        "
      >
        记录付款 <ArrowUpRight :size="14" />
      </button>
    </article>
  </div>
  <EmptyState
    v-if="query.data.value && !query.data.value.data.length"
    title="给家的第一份采购计划"
    description="从瓷砖到灯具，把想买的先记下来。"
    :action="w.canWrite && !deleted ? '添加材料' : undefined"
    @action="w.open('material')"
  />
  <div v-if="query.data.value?.meta.total > 30" class="pagination">
    <button
      class="btn secondary small-btn"
      :disabled="page === 1"
      @click="page--"
    >
      上一页</button
    ><span>第 {{ page }} 页</span
    ><button
      class="btn secondary small-btn"
      :disabled="page * 30 >= query.data.value!.meta.total"
      @click="page++"
    >
      下一页
    </button>
  </div>
</template>
