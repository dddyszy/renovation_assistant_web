<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import type { NotesArchive } from "../../shared/notes-transfer";
import {
  NOTES_FILE_LIMIT,
  parseNotesArchive,
  stringifyNotesArchive,
} from "../../shared/notes-transfer";
import type { NoteColumn } from "../../shared/api";
import { useWorkspace } from "../stores/workspace";
import { errorMessage, request } from "../services/api";

const props = defineProps<{ columns: NoteColumn[]; currentColumn: string }>();
const emit = defineEmits<{ close: [] }>();
const w = useWorkspace();
const client = useQueryClient();
const panel = ref<HTMLElement>();
let priorFocus: HTMLElement | null = null;
onMounted(() => {
  priorFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  panel.value?.focus();
});
onUnmounted(() => priorFocus?.focus());
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape" && !busy.value) emit("close");
  if (event.key !== "Tab") return;
  const controls = panel.value?.querySelectorAll<HTMLElement>(
    "button:not(:disabled),select:not(:disabled),input:not(:disabled)",
  );
  if (!controls?.length) return;
  const first = controls[0]!,
    last = controls[controls.length - 1]!;
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    first.focus();
  }
}
const target = {
  base: w.base,
  fid: w.fid,
  pid: w.pid,
  name: w.project?.name || "装修项目",
};
const scope = ref("all"),
  archive = ref<NotesArchive>(),
  error = ref(""),
  busy = ref(false),
  message = ref("");
const total = computed(
  () => archive.value?.columns.reduce((sum, column) => sum + column.items.length, 0) || 0,
);
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true;
  archive.value = undefined;
  error.value = "";
  message.value = "";
  try {
    if (file.size > NOTES_FILE_LIMIT) throw new Error("备忘文件不能超过 2 MiB");
    archive.value = parseNotesArchive(await file.text());
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function exportFile() {
  busy.value = true;
  error.value = "";
  try {
    const suffix =
      scope.value === "column"
        ? `?columnId=${encodeURIComponent(props.currentColumn)}`
        : "";
    const result = await request<NotesArchive>(`${target.base}/notes/export${suffix}`);
    const content = stringifyNotesArchive(result.data);
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `装修备忘-${target.name.replace(/[^\p{L}\p{N}._ -]/gu, "_")}-${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.value = "已生成 JSON 文件，可在 Web 或小程序中导入。";
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function importFile() {
  if (!archive.value || busy.value || !w.canWrite) return;
  busy.value = true;
  error.value = "";
  try {
    const { data } = await request<{
      added: number;
      skipped: number;
      createdColumns: number;
    }>(`${target.base}/notes/import-file`, "POST", archive.value);
    archive.value = undefined;
    message.value = `导入完成：新增 ${data.added} 条，跳过重复 ${data.skipped} 条，新建 ${data.createdColumns} 个专栏。`;
    await client.invalidateQueries({ queryKey: ["project", target.fid, target.pid] });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="!busy && emit('close')" @keydown="keyboard">
    <section
      ref="panel"
      class="modal-card transfer-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-title"
      tabindex="-1"
    >
      <header class="modal-header">
        <h2 id="transfer-title">备忘导入 / 导出</h2>
        <button class="text-btn" :disabled="busy" @click="emit('close')">关闭</button>
      </header>
      <p class="muted">
        当前项目：{{ target.name }}。JSON 文件兼容 Web 与微信小程序 0.9.6。
      </p>
      <p v-if="error" class="error-box" role="alert">{{ error }}</p>
      <p v-if="message" class="success-box" role="status">{{ message }}</p>
      <div class="transfer-section">
        <h3>导出备忘</h3>
        <label class="field"
          >导出范围<select v-model="scope" :disabled="busy">
            <option value="all">整个项目（全部专栏）</option>
            <option value="column" :disabled="!currentColumn">
              当前专栏：{{ columns.find((c) => c.id === currentColumn)?.name }}
            </option>
          </select></label
        >
        <p class="muted small-text">
          包含范围内全部有效备忘，不受筛选、分页影响；不导出最近删除内容。
        </p>
        <button class="btn secondary" :disabled="busy" @click="exportFile">
          导出 JSON 文件
        </button>
      </div>
      <div v-if="w.canWrite" class="transfer-section">
        <h3>导入到当前项目</h3>
        <label class="field"
          >选择备忘 JSON 文件（最多 2 MiB）<input
            type="file"
            accept=".json,application/json"
            :disabled="busy"
            @change="chooseFile"
        /></label>
        <p class="muted small-text">
          同名专栏合并，新专栏按文件顺序追加。标题、描述、重点及状态完全相同的备忘自动跳过；已有内容不覆盖。
        </p>
        <div v-if="archive" class="import-preview">
          <p>
            来源项目：{{ archive.projectName || "未命名项目" }} ·
            {{ archive.source === "web" ? "Web" : "微信小程序" }}
          </p>
          <p>共 {{ archive.columns.length }} 个专栏，{{ total }} 条备忘</p>
          <ul>
            <li v-for="column in archive.columns" :key="column.name">
              {{ column.name }}：{{ column.items.length }} 条
            </li>
          </ul>
          <button
            class="btn primary"
            :disabled="busy || !archive.columns.length"
            @click="importFile"
          >
            {{ busy ? "正在导入…" : "确认追加导入" }}
          </button>
        </div>
      </div>
      <p v-else class="muted">当前权限可导出备忘；导入需要可编辑的项目与成员权限。</p>
    </section>
  </div>
</template>
