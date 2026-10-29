<script setup lang="ts">
import type { Stage, StageStatus } from "../../shared/api";
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { Plus, Check, Settings2, ArrowUp, ArrowDown, ArrowRight } from "@lucide/vue";
import { useWorkspace } from "../stores/workspace";
import { useProjectQuery } from "../composables/useProjectQuery";
import { request, errorMessage } from "../services/api";
import { money, stageLabels } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
import EmptyState from "../components/EmptyState.vue";
const w = useWorkspace(),
  query = useProjectQuery("statistics"),
  client = useQueryClient(),
  error = ref(""),
  busy = ref(false);
const stages = computed(() => query.data.value?.data?.stages || []);
async function status(s: Stage, value: StageStatus) {
  busy.value = true;
  try {
    await request(`${w.base}/stages/${s.id}`, "PATCH", {
      status: value,
      version: s.version,
    });
    await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function move(index: number, direction: number) {
  const list = [...stages.value];
  [list[index], list[index + direction]] = [list[index + direction], list[index]];
  busy.value = true;
  try {
    await request(`${w.base}/stages/reorder`, "POST", {
      items: list.map((s) => ({ id: s.id, version: s.version })),
    });
    await query.refetch();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">ONE STEP CLOSER TO HOME</span>
      <h1>阶段计划</h1>
      <p>不赶进度，按自己的节奏，把家一步步筑好。</p>
    </div>
    <button v-if="w.isAdmin && w.canWrite" class="btn primary" @click="w.open('stage')">
      <Plus :size="18" />添加阶段
    </button>
  </div>
  <QueryState
    :loading="query.isPending.value"
    :error="query.error.value"
    @retry="query.refetch()"
  />
  <div v-if="error" class="error-box">{{ error }}</div>
  <div class="stage-timeline">
    <article
      v-for="(s, i) in stages"
      :key="s.id"
      :class="[
        'panel timeline-card',
        {
          running: s.status === 'in_progress',
          complete: s.status === 'completed',
        },
      ]"
    >
      <span class="timeline-number"
        ><Check v-if="s.status === 'completed'" :size="19" /><template v-else>{{
          String(Number(i) + 1).padStart(2, "0")
        }}</template></span
      >
      <div class="timeline-content">
        <header>
          <div>
            <span :class="['pill', s.status === 'in_progress' ? 'green' : 'neutral']">{{
              stageLabels[s.status]
            }}</span>
            <h2>{{ s.name }}</h2>
          </div>
          <div v-if="w.isAdmin && w.canWrite" class="inline-actions">
            <button
              class="icon-btn"
              aria-label="上移阶段"
              :disabled="Number(i) === 0 || busy"
              @click="move(Number(i), -1)"
            >
              <ArrowUp :size="17" /></button
            ><button
              class="icon-btn"
              aria-label="下移阶段"
              :disabled="Number(i) === stages.length - 1 || busy"
              @click="move(Number(i), 1)"
            >
              <ArrowDown :size="17" /></button
            ><button class="icon-btn" aria-label="阶段设置" @click="w.open('stage', s)">
              <Settings2 :size="18" />
            </button>
          </div>
        </header>
        <div class="stage-money-grid">
          <div>
            <span>阶段预算</span><strong>{{ money(s.budgetCents) }}</strong>
          </div>
          <div>
            <span>材料计划</span><strong>{{ money(s.plannedCents) }}</strong>
          </div>
          <div>
            <span>已记成本</span
            ><strong
              :class="{
                danger: s.budgetCents > 0 && s.actualCents > s.budgetCents,
              }"
              >{{ money(s.actualCents) }}</strong
            >
          </div>
        </div>
        <footer>
          <RouterLink :to="{ path: '/ledger', query: { stageId: s.id } }" class="text-btn"
            >查看阶段支出<ArrowRight :size="14" /></RouterLink
          ><select
            v-if="w.canWrite"
            :value="s.status"
            :disabled="busy"
            :aria-label="`${s.name}施工状态`"
            @change="status(s, ($event.target as HTMLSelectElement).value as StageStatus)"
          >
            <option value="pending">未开始</option>
            <option value="in_progress">进行中</option>
            <option value="completed">已完成</option>
          </select>
        </footer>
      </div>
    </article>
  </div>
  <EmptyState
    v-if="!query.isPending.value && !stages.length"
    title="安排家的第一步"
    description="选择适合自己的装修工序，逐步分配预算。"
    :action="w.isAdmin && w.canWrite ? '添加阶段' : undefined"
    @action="w.open('stage')"
  />
</template>
