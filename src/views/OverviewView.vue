<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Package,
  Layers,
  ChartNoAxesCombined,
  Users,
  Clock3,
  CircleCheck,
  Leaf,
} from "@lucide/vue";
import { useWorkspace } from "../stores/workspace";
import { useProjectQuery } from "../composables/useProjectQuery";
import { money, stageLabels } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
import CostRows from "../components/CostRows.vue";
import EmptyState from "../components/EmptyState.vue";
const w = useWorkspace(),
  query = useProjectQuery("statistics"),
  index = ref(0);
const stats = computed(() => query.data.value?.data);
const activeStages = computed(() =>
  stats.value?.stages.filter((s) => s.status === "in_progress").length
    ? stats.value.stages.filter((s) => s.status === "in_progress")
    : stats.value?.stages.filter((s) => s.status === "pending") || [],
);
const stage = computed(
  () => activeStages.value[index.value % Math.max(activeStages.value.length, 1)],
);
const ratio = computed(() =>
  w.project?.budgetCents
    ? Math.round(((stats.value?.totalCents || 0) / w.project.budgetCents) * 100)
    : 0,
);
const progress = computed(() =>
  stats.value?.stages.length
    ? Math.round(
        (stats.value.stages.filter((s) => s.status === "completed").length /
          stats.value.stages.length) *
          100,
      )
    : 0,
);
const shortcuts = [
  { path: "/stages", label: "阶段计划", icon: Layers },
  { path: "/materials", label: "材料清单", icon: Package },
  { path: "/statistics", label: "预算统计", icon: ChartNoAxesCombined },
  { path: "/family", label: "家人协作", icon: Users },
];
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">
        OUR RENOVATION JOURNAL <span class="eyebrow-dot" />
        {{ w.project?.packageType === "full" ? "全包" : "半包" }}装修
      </div>
      <h1>
        {{ w.project?.name
        }}<span class="heading-leaf"><Leaf :size="22" :stroke-width="1.4" /></span>
      </h1>
      <p>把每一笔记清楚，让家的模样更近一点。</p>
    </div>
    <button v-if="w.canWrite" class="btn primary desktop-record" @click="w.open('cost')">
      <Plus :size="18" />记一笔
    </button>
  </div>
  <QueryState
    :loading="query.isPending.value"
    :error="query.error.value"
    @retry="query.refetch()"
  />
  <template v-if="stats"
    ><section class="budget-hero">
      <div class="budget-main">
        <div class="card-eyebrow">
          装修预算
          <RouterLink to="/statistics"
            >查看预算明细 <ArrowUpRight :size="15"
          /></RouterLink>
        </div>
        <div class="budget-figures">
          <div class="budget-figure">
            <span>已使用</span>
            <strong>{{ money(stats.totalCents) }}</strong>
          </div>
          <div
            class="budget-figure remaining"
            :class="{ danger: w.project?.budgetCents && stats.balanceCents < 0 }"
          >
            <span>{{
              w.project?.budgetCents && stats.balanceCents < 0 ? "已超预算" : "剩余预算"
            }}</span>
            <strong>{{
              w.project?.budgetCents ? money(Math.abs(stats.balanceCents)) : "—"
            }}</strong>
          </div>
        </div>
        <div class="budget-track">
          <span
            :class="{ over: ratio > 100 }"
            :style="{ width: Math.min(ratio, 100) + '%' }"
          />
        </div>
        <div class="budget-track-meta">
          <span
            >总预算 <strong>{{ money(w.project?.budgetCents) }}</strong></span
          ><span>{{
            w.project?.budgetCents ? `已使用 ${ratio}%` : "尚未设置总预算"
          }}</span>
        </div>
      </div>
      <div class="budget-side">
        <div>
          <span><i class="legend-dot wood" />已付金额</span
          ><strong>{{ money(stats.paidCents) }}</strong
          ><small>每一笔，都是家的积累</small>
        </div>
        <div>
          <span><i class="legend-dot sage" />待付金额</span
          ><strong>{{ money(stats.pendingCents) }}</strong
          ><small>提前安排，心里更有底</small>
        </div>
      </div>
    </section>
    <div class="budget-footnote">
      <span
        >已记总成本 <strong>{{ money(stats.totalCents) }}</strong
        ><i />阶段预算已分配 {{ money(stats.allocatedCents) }}</span
      ><RouterLink to="/statistics"
        >{{
          stats.allocatedCents > w.project!.budgetCents ? "阶段预算超分配" : "未分配预算"
        }}
        {{ money(Math.abs(w.project!.budgetCents - stats.allocatedCents)) }}
        <ChevronRight :size="14"
      /></RouterLink>
    </div>
    <div v-if="stats.balanceCents < 0 || ratio >= 90" class="warning-box">
      <Clock3 :size="17" />{{
        stats.balanceCents < 0
          ? "已记成本超过总预算，和家人一起检查接下来的安排。"
          : "预算使用已接近上限，记得为后续采购留一点余地。"
      }}
    </div>
    <div class="overview-columns">
      <section class="stage-section">
        <div class="section-head">
          <h2>家的进度<span class="section-kicker">一步一步，离家更近</span></h2>
          <RouterLink to="/stages" class="subtle-link"
            >全部阶段 <ArrowRight :size="15"
          /></RouterLink>
        </div>
        <div v-if="stage" class="panel current-stage">
          <div class="stage-topline">
            <span :class="['pill', stage.status === 'in_progress' ? 'green' : 'neutral']"
              ><span class="tiny-dot" />{{ stageLabels[stage.status] }}</span
            ><span class="muted small-text">已完成 {{ progress }}%</span>
          </div>
          <div class="stage-title-line">
            <h3>{{ stage.name }}</h3>
            <span class="stage-step"
              >{{
                String(stats.stages.findIndex((s) => s.id === stage.id) + 1).padStart(
                  2,
                  "0",
                )
              }}<small> / {{ String(stats.stages.length).padStart(2, "0") }}</small></span
            >
          </div>
          <div class="stage-money-grid">
            <div>
              <span>阶段预算</span><strong>{{ money(stage.budgetCents) }}</strong>
            </div>
            <div>
              <span>材料计划</span><strong>{{ money(stage.plannedCents) }}</strong>
            </div>
            <div>
              <span>已记成本</span
              ><strong
                :class="{
                  danger: stage.budgetCents > 0 && stage.actualCents > stage.budgetCents,
                }"
                >{{ money(stage.actualCents) }}</strong
              >
            </div>
          </div>
          <div class="thin-track">
            <span
              :style="{
                width:
                  Math.min(
                    stage.budgetCents ? (stage.actualCents / stage.budgetCents) * 100 : 0,
                    100,
                  ) + '%',
              }"
            />
          </div>
          <div class="stage-footer">
            <RouterLink to="/stages"
              >查看本阶段材料与支出 <ArrowRight :size="14"
            /></RouterLink>
            <div v-if="activeStages.length > 1" class="carousel-control">
              <button
                aria-label="上一个阶段"
                @click="index = (index - 1 + activeStages.length) % activeStages.length"
              >
                <ChevronLeft :size="16" /></button
              ><span
                >{{ (index % activeStages.length) + 1 }} / {{ activeStages.length }}</span
              ><button aria-label="下一个阶段" @click="index++">
                <ChevronRight :size="16" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="panel">
          <EmptyState
            :title="stats.stages.length ? '所有阶段已完成' : '还没有装修阶段'"
            :description="
              stats.stages.length
                ? '家的模样，终于从计划变成了日常。'
                : '进入阶段计划，安排家的第一步。'
            "
          />
        </div>
      </section>
      <section class="reminders-section">
        <div class="section-head">
          <h2>接下来要记得</h2>
          <span class="mini-label">别让小事溜走</span>
        </div>
        <div class="panel reminders">
          <RouterLink
            :to="{ path: '/ledger', query: { paymentStatus: 'pending' } }"
            class="reminder-row"
            ><span class="reminder-icon amber-bg"><Clock3 :size="20" /></span
            ><span
              ><strong>待付款安排</strong
              ><small>{{
                stats.pendingCents
                  ? `还有 ${money(stats.pendingCents)} 待支付`
                  : "暂无待付款，轻松一点"
              }}</small></span
            ><ChevronRight :size="15" /></RouterLink
          ><RouterLink to="/notes" class="reminder-row"
            ><span class="reminder-icon sage-bg"><CircleCheck :size="20" /></span
            ><span
              ><strong>和家人确认一下</strong
              ><small>{{
                stats.pendingNoteCount
                  ? `${stats.pendingNoteCount} 项装修需求等待确认`
                  : "想法和需求，都可以先记下来"
              }}</small></span
            ><ChevronRight :size="15"
          /></RouterLink>
          <div class="reminder-quote">
            <Leaf :size="16" /><span>家不必一步到位，喜欢可以慢慢添。</span>
          </div>
        </div>
      </section>
    </div>
    <section class="quick-access">
      <RouterLink v-for="s in shortcuts" :key="s.path" :to="s.path"
        ><component :is="s.icon" :size="20" :stroke-width="1.5" /><span>{{
          s.label
        }}</span
        ><ArrowUpRight :size="15"
      /></RouterLink>
    </section>
    <section>
      <div class="section-head">
        <h2>最近的支出<span class="section-kicker">每一笔，都有迹可循</span></h2>
        <RouterLink to="/ledger" class="subtle-link"
          >查看全部 <ArrowRight :size="15"
        /></RouterLink>
      </div>
      <div class="panel recent-panel">
        <div v-if="stats.recent.length" class="table-caption">
          <span>支出事项 / 记录人</span><span>金额 / 支付状态</span>
        </div>
        <CostRows :items="stats.recent" :stages="stats.stages" /><EmptyState
          v-if="!stats.recent.length"
          title="还没有支出记录"
          description="从第一笔支出开始，把预算变成安心。"
          :action="w.canWrite ? '记下第一笔' : undefined"
          @action="w.open('cost')"
        />
      </div></section
  ></template>
</template>
