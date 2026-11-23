<script setup lang="ts">
import { ref } from "vue";
import { X } from "@lucide/vue";
import type { NoteColumn } from "../../shared/api";
import { useWorkspace } from "../stores/workspace";
import { errorMessage, request } from "../services/api";

const props = defineProps<{ column: NoteColumn }>();
const emit = defineEmits<{ close: [] }>();
const w = useWorkspace();
const url = ref("");
const busy = ref(false);
const copied = ref(false);
const error = ref("");

async function create() {
  busy.value = true;
  error.value = "";
  copied.value = false;
  try {
    const { data } = await request<{ path: string }>(
      `${w.base}/note-columns/${props.column.id}/share`,
      "POST",
      {},
    );
    url.value = new URL(data.path, window.location.origin).toString();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function stop() {
  busy.value = true;
  try {
    await request(`${w.base}/note-columns/${props.column.id}/share`, "DELETE");
    url.value = "";
    w.notify("已停止分享");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(url.value);
    copied.value = true;
  } catch {
    document.querySelector<HTMLInputElement>(".column-share-link input")?.select();
    copied.value = false;
  }
}
function focusInput(event: Event) {
  (event.target as HTMLInputElement).select();
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      class="modal-card column-share-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="column-share-title"
    >
      <header class="modal-header">
        <div>
          <span class="eyebrow">只读分享</span>
          <h2 id="column-share-title">分享「{{ column.name }}」</h2>
        </div>
        <button class="icon-btn" aria-label="关闭" @click="emit('close')">
          <X :size="22" />
        </button>
      </header>
      <div v-if="error" class="error-box" role="alert">{{ error }}</div>
      <p class="field-help">
        链接 7
        天内有效，任何人可只读查看该专栏的全部备忘和图片，无需登录；重新生成或停止分享会让旧链接立即失效。
      </p>
      <div v-if="url" class="column-share-link share-link">
        <input :value="url" readonly @focus="focusInput" />
        <button type="button" class="text-btn" @click="copy">
          {{ copied ? "已复制" : "复制" }}
        </button>
      </div>
      <footer class="modal-footer">
        <span class="save-hint"></span>
        <div class="inline-actions">
          <button type="button" class="btn secondary" @click="emit('close')">关闭</button>
          <button
            v-if="url"
            type="button"
            class="text-btn danger"
            :disabled="busy"
            @click="stop"
          >
            停止分享
          </button>
          <button type="button" class="btn primary" :disabled="busy" @click="create">
            {{ url ? "重新生成链接" : "生成分享链接" }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
