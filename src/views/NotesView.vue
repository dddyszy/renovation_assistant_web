<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Plus,
  Star,
  Check,
  ArrowDownToLine,
  Settings2,
  RotateCcw,
  ArrowUp,
  ArrowDown,
} from "@lucide/vue";
import { useWorkspace } from "../workspace";
import { useProjectQuery } from "../queries";
import { request } from "../api";
import QueryState from "../components/QueryState.vue";
import EmptyState from "../components/EmptyState.vue";
const w = useWorkspace(),
  columns = useProjectQuery("note-columns"),
  client = useQueryClient(),
  columnId = ref(""),
  status = ref(""),
  starred = ref(false),
  deleted = ref(false),
  page = ref(1),
  error = ref(""),
  managing = ref(false),
  busy = ref(false);
watch(
  () => columns.data.value?.data,
  (list) => {
    if (!list?.some((c: any) => c.id === columnId.value))
      columnId.value = list?.[0]?.id || "";
  },
  { immediate: true },
);
const params = computed(() =>
  new URLSearchParams({
    columnId: columnId.value,
    page: String(page.value),
    ...(status.value ? { status: status.value } : {}),
    ...(starred.value ? { starred: "true" } : {}),
    ...(deleted.value ? { deleted: "true" } : {}),
  }).toString(),
);
const query = useQuery({
  queryKey: computed(() => [
    "project",
    w.fid,
    w.pid,
    "notes-list",
    params.value,
  ]),
  enabled: computed(() => !!columnId.value && !!w.project),
  queryFn: () => request(`${w.base}/notes?${params.value}`),
  refetchInterval: 30000,
});
async function toggle(n: any, field: string) {
  busy.value = true;
  try {
    await request(`${w.base}/notes/${n.id}`, "PATCH", {
      ...n,
      [field]:
        field === "starred"
          ? !n.starred
          : n.status === "confirmed"
            ? "pending"
            : "confirmed",
    });
    await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function restore(n: any) {
  try {
    await request(`${w.base}/notes/${n.id}/restore`, "POST", {
      version: n.version,
    });
    await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
  } catch (e: any) {
    error.value = e.message;
  }
}
async function moveColumn(i: number, direction: number) {
  busy.value = true;
  try {
    const list = [...columns.data.value!.data];
    [list[i], list[i + direction]] = [list[i + direction], list[i]];
    await request(`${w.base}/note-columns/reorder`, "POST", {
      items: list.map((c) => ({ id: c.id, version: c.version })),
    });
    await client.invalidateQueries({ queryKey: ["project", w.fid, w.pid] });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function add() {
  w.open("note", {
    title: "",
    columnId: columnId.value,
    details: [],
    starred: false,
    status: "pending",
  });
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">IDEAS MAKE A HOUSE A HOME</span>
      <h1>要确认的事</h1>
      <p>把想法记下来，和家人一起慢慢商量。</p>
    </div>
    <div v-if="w.canWrite" class="inline-actions">
      <button class="btn secondary" @click="w.open('import', { columnId })">
        <ArrowDownToLine :size="17" />粘贴导入</button
      ><button class="btn primary" :disabled="!columnId" @click="add">
        <Plus :size="18" />新增需求
      </button>
    </div>
  </div>
  <div v-if="error" class="error-box">{{ error }}</div>
  <QueryState
    :loading="columns.isPending.value"
    :error="columns.error.value"
    @retry="columns.refetch()"
  />
  <div class="notes-layout">
    <aside class="panel note-sidebar">
      <header>
        <span>备忘专栏</span
        ><button
          v-if="w.canWrite"
          class="icon-btn"
          aria-label="管理专栏"
          @click="managing = !managing"
        >
          <Settings2 :size="17" />
        </button>
      </header>
      <div
        v-for="(c, i) in columns.data.value?.data || []"
        :key="c.id"
        class="column-wrap"
      >
        <button
          :class="['column-link', { selected: columnId === c.id }]"
          @click="
            columnId = c.id;
            page = 1;
          "
        >
          {{ c.name }}<span v-if="columnId === c.id" class="nav-dot" />
        </button>
        <div v-if="managing && w.canWrite" class="column-tools">
          <button class="text-btn" @click="w.open('column', c)">
            改名 / 删除</button
          ><button
            class="icon-btn"
            aria-label="上移专栏"
            :disabled="Number(i) === 0 || busy"
            @click="moveColumn(Number(i), -1)"
          >
            <ArrowUp :size="14" /></button
          ><button
            class="icon-btn"
            aria-label="下移专栏"
            :disabled="
              Number(i) === columns.data.value!.data.length - 1 || busy
            "
            @click="moveColumn(Number(i), 1)"
          >
            <ArrowDown :size="14" />
          </button>
        </div>
      </div>
      <button
        v-if="w.canWrite"
        class="text-btn add-column"
        @click="w.open('column')"
      >
        <Plus :size="16" />新建专栏
      </button>
    </aside>
    <div class="note-main">
      <div class="notes-toolbar">
        <div class="segmented">
          <button
            v-for="s in [
              { value: '', label: '全部' },
              { value: 'pending', label: '待确认' },
              { value: 'confirmed', label: '已确认' },
            ]"
            :key="s.value"
            :class="{ selected: status === s.value }"
            @click="
              status = s.value;
              page = 1;
            "
          >
            {{ s.label }}
          </button>
        </div>
        <button
          :class="['text-btn', { gold: starred }]"
          @click="
            starred = !starred;
            page = 1;
          "
        >
          <Star
            :size="16"
            :fill="starred ? 'currentColor' : 'none'"
          />只看重点</button
        ><button
          class="icon-btn"
          :aria-label="deleted ? '返回备忘' : '最近删除'"
          @click="
            deleted = !deleted;
            page = 1;
          "
        >
          <RotateCcw :size="17" />
        </button>
      </div>
      <QueryState
        :loading="!!columnId && query.isPending.value"
        :error="query.error.value"
        @retry="query.refetch()"
      />
      <article
        v-for="n in query.data.value?.data || []"
        :key="n.id"
        :class="['panel note-card', { confirmed: n.status === 'confirmed' }]"
      >
        <header>
          <button
            class="note-star"
            :disabled="!w.canWrite || deleted || busy"
            :aria-label="n.starred ? '取消重点' : '标记重点'"
            @click="toggle(n, 'starred')"
          >
            <Star
              :size="20"
              :class="{ gold: n.starred }"
              :fill="n.starred ? 'currentColor' : 'none'"
            /></button
          ><button
            class="note-title"
            :disabled="deleted"
            @click="w.open('note', n)"
          >
            {{ n.title }}</button
          ><button
            v-if="!deleted"
            :class="['pill', n.status === 'confirmed' ? 'green' : 'neutral']"
            :disabled="!w.canWrite || busy"
            @click="toggle(n, 'status')"
          >
            <Check v-if="n.status === 'confirmed'" :size="12" />{{
              n.status === "confirmed" ? "已确认" : "待确认"
            }}</button
          ><button v-else-if="w.canWrite" class="text-btn" @click="restore(n)">
            恢复
          </button>
        </header>
        <ul v-if="n.details.length">
          <li v-for="(d, i) in n.details" :key="i">{{ d }}</li>
        </ul>
        <footer>
          {{ n.creatorName }}记录 ·
          {{ n.createdAt.slice(0, 10).replaceAll("-", ".") }}
        </footer>
      </article>
      <EmptyState
        v-if="
          !columns.data.value?.data.length ||
          (query.data.value && !query.data.value.data.length)
        "
        :title="deleted ? '这里没有已删除的备忘' : '想法先记下，答案慢慢找'"
        description="从物业要求到插座位置，家的细节都值得商量。"
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
    </div>
  </div>
</template>
