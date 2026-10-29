<script setup lang="ts">
import { computed } from "vue";
import { ChartNoAxesCombined, ArrowUpRight } from "@lucide/vue";
import { useWorkspace } from "../workspace";
import { useProjectQuery } from "../queries";
import { money } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
const w = useWorkspace(),
  query = useProjectQuery("statistics"),
  s = computed(() => query.data.value?.data);
const max = computed(() =>
  Math.max(
    1,
    ...(s.value?.stages || []).flatMap((s: any) => [
      s.budgetCents,
      s.actualCents,
    ]),
  ),
);
const palette = [
  "#8b5e3c",
  "#8c9d80",
  "#c2a16f",
  "#c1836a",
  "#9c9690",
  "#c7b9a3",
];
const gradient = computed(() => {
  let from = 0;
  return (
    "conic-gradient(" +
    (s.value?.byCategory || [])
      .map((c: any, i: number) => {
        const to = from + (c.amountCents / s.value!.totalCents) * 100;
        const str = `${palette[i % palette.length]} ${from}% ${to}%`;
        from = to;
        return str;
      })
      .join(",") +
    ")"
  );
});
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">A LITTLE CLARITY, A LOT OF PEACE</span>
      <h1>预算心中有数</h1>
      <p>花了多少，还剩多少，下一步怎么安排。</p>
    </div>
    <button
      v-if="w.isAdmin && w.canWrite"
      class="btn secondary"
      @click="w.open('project', w.project!)"
    >
      调整预算<ArrowUpRight :size="17" />
    </button>
  </div>
  <QueryState
    :loading="query.isPending.value"
    :error="query.error.value"
    @retry="query.refetch()"
  /><template v-if="s"
    ><div class="stat-cards">
      <div class="panel">
        <span>装修总预算</span><strong>{{ money(s.budgetCents) }}</strong>
      </div>
      <div class="panel">
        <span>已记总成本</span><strong>{{ money(s.totalCents) }}</strong
        ><small
          >已付 {{ money(s.paidCents) }} + 待付
          {{ money(s.pendingCents) }}</small
        >
      </div>
      <div class="panel">
        <span>{{ s.balanceCents < 0 ? "超出预算" : "预算余额" }}</span
        ><strong :class="{ danger: s.balanceCents < 0 }">{{
          money(Math.abs(s.balanceCents))
        }}</strong>
      </div>
    </div>
    <div class="statistics-grid">
      <section class="panel chart-panel">
        <div class="section-head">
          <h2>阶段预算与成本</h2>
          <div class="chart-legend">
            <span><i class="legend-dot sage" />预算</span
            ><span><i class="legend-dot wood" />成本</span>
          </div>
        </div>
        <div v-for="stage in s.stages" :key="stage.id" class="bar-row">
          <div class="bar-label">
            <strong>{{ stage.name }}</strong
            ><small
              :class="{
                danger:
                  stage.budgetCents > 0 &&
                  stage.actualCents > stage.budgetCents,
              }"
              >{{ money(stage.actualCents) }} /
              {{ money(stage.budgetCents) }}</small
            >
          </div>
          <div class="double-bars">
            <span
              :style="{ width: (stage.budgetCents / max) * 100 + '%' }"
            /><span
              :class="{
                over:
                  stage.budgetCents > 0 &&
                  stage.actualCents > stage.budgetCents,
              }"
              :style="{ width: (stage.actualCents / max) * 100 + '%' }"
            />
          </div>
        </div>
        <p v-if="!s.stages.length" class="muted">
          尚无阶段，先安排装修计划吧。
        </p>
      </section>
      <section class="panel chart-panel">
        <div class="section-head">
          <h2>钱都花在哪里</h2>
          <span class="mini-label">按费用分类</span>
        </div>
        <div
          :class="['donut', { empty: !s.totalCents }]"
          :style="s.totalCents ? { background: gradient } : {}"
          role="img"
          :aria-label="`已记总成本 ${money(s.totalCents)}，分类明细见下方`"
        >
          <div>
            <span>已记总成本</span><strong>{{ money(s.totalCents) }}</strong>
          </div>
        </div>
        <div class="category-legend">
          <div v-for="(c, i) in s.byCategory" :key="c.category">
            <span
              ><i
                class="legend-dot"
                :style="{ background: palette[Number(i) % palette.length] }"
              />{{ c.category }}</span
            ><strong>{{ money(c.amountCents) }}</strong
            ><small
              >{{ Math.round((c.amountCents / s.totalCents) * 100) }}%</small
            >
          </div>
          <p v-if="!s.byCategory.length" class="muted">
            记下第一笔后，这里会展示费用分布。
          </p>
        </div>
      </section>
    </div>
    <div class="panel allocation-panel">
      <h2>预算分配与材料计划</h2>
      <div class="allocation-grid">
        <div>
          <span>阶段预算已分配</span
          ><strong>{{ money(s.allocatedCents) }}</strong>
        </div>
        <div>
          <span>{{
            s.allocatedCents > s.budgetCents ? "超分配金额" : "未分配预算"
          }}</span
          ><strong :class="{ danger: s.allocatedCents > s.budgetCents }">{{
            money(Math.abs(s.budgetCents - s.allocatedCents))
          }}</strong>
        </div>
        <div>
          <span>材料计划总额</span><strong>{{ money(s.plannedCents) }}</strong>
        </div>
      </div>
      <p class="muted small-text">
        预算余额 = 总预算 − 已付 −
        待付。材料计划不重复计入成本；尚未登记的费用不在统计内。
      </p>
    </div></template
  >
</template>
