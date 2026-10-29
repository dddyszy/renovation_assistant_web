<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Plus,
  Search,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "@lucide/vue";
import { request } from "../api";
import { useWorkspace } from "../workspace";
import { useProjectQuery } from "../queries";
import { money, categories } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
import EmptyState from "../components/EmptyState.vue";
import CostRows from "../components/CostRows.vue";
const w = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  client = useQueryClient(),
  stages = useProjectQuery("stages");
const filter = ref({
  keyword: String(route.query.keyword || ""),
  stageId: String(route.query.stageId || ""),
  paymentStatus: String(route.query.paymentStatus || ""),
  category: String(route.query.category || ""),
  from: String(route.query.from || ""),
  to: String(route.query.to || ""),
  deleted: String(route.query.deleted || ""),
  page: Number(route.query.page) || 1,
});
const search = ref(filter.value.keyword);
const params = computed(() => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter.value)) if (v) p.set(k, String(v));
  return p.toString();
});
const query = useQuery({
  enabled: computed(() => !!w.project),
  queryKey: computed(() => ["project", w.fid, w.pid, "ledger", params.value]),
  queryFn: () => request(`${w.base}/costs?${params.value}`),
  refetchInterval: 30000,
});
const rows = computed(() => query.data.value?.data || []),
  meta = computed(() => query.data.value?.meta);
watch(
  filter,
  () => {
    router.replace({
      query: Object.fromEntries(new URLSearchParams(params.value).entries()),
    });
  },
  { deep: true },
);
watch(
  () => route.query.paymentStatus,
  (v) => {
    filter.value.paymentStatus = String(v || "");
  },
);
function apply() {
  filter.value.keyword = search.value;
  filter.value.page = 1;
}
async function restore(row: any) {
  try {
    await request(`${w.base}/costs/${row.id}/restore`, "POST", {
      version: row.version,
    });
    await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
    w.notify("支出已恢复");
  } catch (e: any) {
    w.notify(e.message);
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">EVERY LITTLE COUNTS</span>
      <h1>装修账本</h1>
      <p>每一笔开销，都在为家的模样添一笔。</p>
    </div>
    <button v-if="w.canWrite" class="btn primary" @click="w.open('cost')">
      <Plus :size="18" />记一笔
    </button>
  </div>
  <div class="panel filter-panel">
    <form class="search-field" @submit.prevent="apply">
      <Search :size="18" /><input
        v-model="search"
        placeholder="搜索支出事项…"
        aria-label="搜索支出"
      /><button class="text-btn">搜索</button>
    </form>
    <div class="filter-row">
      <select
        v-model="filter.stageId"
        aria-label="按阶段筛选"
        @change="filter.page = 1"
      >
        <option value="">全部阶段</option>
        <option
          v-for="s in stages.data.value?.data || []"
          :key="s.id"
          :value="s.id"
        >
          {{ s.name }}
        </option></select
      ><select
        v-model="filter.paymentStatus"
        aria-label="按支付状态筛选"
        @change="filter.page = 1"
      >
        <option value="">全部支付状态</option>
        <option value="paid">已支付</option>
        <option value="pending">待支付</option></select
      ><select
        v-model="filter.category"
        aria-label="按费用分类筛选"
        @change="filter.page = 1"
      >
        <option value="">全部分类</option>
        <option
          v-for="c in categories[
            w.project?.packageType === 'full' ? 'full' : 'half'
          ]"
          :key="c"
        >
          {{ c }}
        </option></select
      ><label class="date-filter"
        >从<input
          v-model="filter.from"
          type="date"
          aria-label="开始日期"
          @change="filter.page = 1" /></label
      ><label class="date-filter"
        >至<input
          v-model="filter.to"
          type="date"
          aria-label="结束日期"
          @change="filter.page = 1"
      /></label>
    </div>
    <div class="filter-footer">
      <span v-if="meta"
        >共 {{ meta.total }} 笔 ·
        {{ filter.deleted ? "已删除记录金额" : "筛选金额合计" }}
        <strong>{{ money(meta.totalCents || 0) }}</strong></span
      ><button
        class="text-btn"
        @click="
          filter.deleted = filter.deleted ? '' : 'true';
          filter.page = 1;
        "
      >
        <RotateCcw :size="14" />{{ filter.deleted ? "返回账本" : "最近删除" }}
      </button>
    </div>
  </div>
  <QueryState
    :loading="query.isPending.value"
    :error="query.error.value"
    @retry="query.refetch()"
  />
  <div v-if="!query.isPending.value && !query.error.value" class="panel">
    <template v-if="!filter.deleted"
      ><CostRows :items="rows" :stages="stages.data.value?.data"
    /></template>
    <div v-else v-for="row in rows" :key="row.id" class="deleted-row">
      <div>
        <strong>{{ row.title }}</strong
        ><small>{{ money(row.amountCents) }} · 已删除</small>
      </div>
      <button
        v-if="w.canWrite"
        class="btn secondary small-btn"
        @click="restore(row)"
      >
        恢复
      </button>
    </div>
    <EmptyState
      v-if="!rows.length"
      :title="filter.deleted ? '没有已删除的支出' : '这里还没有记录'"
      description="换个筛选条件，或者记下新的支出。"
    />
  </div>
  <div v-if="meta && meta.total > 30" class="pagination">
    <button
      class="btn secondary small-btn"
      :disabled="filter.page <= 1"
      @click="filter.page--"
    >
      <ChevronLeft :size="16" />上一页</button
    ><span>{{ filter.page }} / {{ Math.ceil(meta.total / 30) }}</span
    ><button
      class="btn secondary small-btn"
      :disabled="filter.page * 30 >= meta.total"
      @click="filter.page++"
    >
      下一页<ChevronRight :size="16" />
    </button>
  </div>
</template>
