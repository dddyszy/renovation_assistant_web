import type { User, Family, Project } from "../../shared/api";
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { request, HttpError, errorMessage } from "../services/api";
// The shared modal accepts partial drafts for several resource shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- constrained to dynamic modal drafts
export type Item = Record<string, any>;
export const useWorkspace = defineStore("workspace", () => {
  const user = ref<User | null>(null),
    families = ref<Family[]>([]),
    projects = ref<Project[]>([]);
  const fid = ref(""),
    pid = ref(""),
    ready = ref(false),
    failure = ref(""),
    modal = ref(""),
    editing = ref<Item | null>(null),
    toast = ref("");
  let timer: ReturnType<typeof setTimeout>;
  const undoAction = ref<(() => Promise<void>) | null>(null);
  function notify(message: string, undo: (() => Promise<void>) | null = null) {
    toast.value = message;
    undoAction.value = undo;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        toast.value = "";
        undoAction.value = null;
      },
      undo ? 15000 : 4500,
    );
  }
  const family = computed(() => families.value.find((f) => f.id === fid.value)),
    project = computed(() =>
      projects.value.find((p) => p.id === pid.value && p.familyId === fid.value),
    );
  const canWrite = computed(
    () =>
      !!family.value &&
      !!project.value &&
      family.value.role !== "viewer" &&
      project.value.status !== "archived",
  );
  const isAdmin = computed(() => ["owner", "admin"].includes(family.value?.role || ""));
  const base = computed(() => `/families/${fid.value}/projects/${pid.value}`);
  function open(type: string, item: Item | null = null) {
    editing.value = item;
    modal.value = type;
  }
  function close() {
    modal.value = "";
    editing.value = null;
  }
  function clear() {
    user.value = null;
    families.value = [];
    projects.value = [];
    fid.value = "";
    pid.value = "";
    undoAction.value = null;
    toast.value = "";
    close();
  }
  async function loadFamilies() {
    const { data } = await request<Family[]>("/families");
    families.value = data;
    if (!data.some((f) => f.id === fid.value)) fid.value = data[0]?.id || "";
    await loadProjects();
  }
  async function loadProjects() {
    if (!fid.value) {
      projects.value = [];
      pid.value = "";
      return;
    }
    const selectedFamily = fid.value;
    if (projects.value.some((p) => p.familyId !== selectedFamily)) {
      projects.value = [];
      pid.value = "";
    }
    const { data } = await request<Project[]>(`/families/${selectedFamily}/projects`);
    if (fid.value !== selectedFamily) return;
    projects.value = data;
    if (!data.some((p) => p.id === pid.value))
      pid.value = data.find((p) => p.status === "active")?.id || data[0]?.id || "";
  }
  async function bootstrap() {
    failure.value = "";
    try {
      user.value = (await request<User>("/me")).data;
      let context: Item = {};
      try {
        context = JSON.parse(localStorage.getItem(`context:${user.value!.id}`) || "{}");
      } catch {
        /* Ignore invalid local preferences. */
      }
      const url = new URLSearchParams(window.location.search);
      fid.value = url.get("family") || user.value!.currentFamilyId || context.fid || "";
      pid.value = url.get("project") || user.value!.currentProjectId || context.pid || "";
      await loadFamilies();
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) failure.value = errorMessage(e);
      clear();
    } finally {
      ready.value = true;
    }
  }
  let preferenceTimer: ReturnType<typeof setTimeout>;
  watch([fid, pid], () => {
    if (user.value) {
      localStorage.setItem(
        `context:${user.value.id}`,
        JSON.stringify({ fid: fid.value, pid: pid.value }),
      );
      clearTimeout(preferenceTimer);
      if (ready.value && fid.value)
        preferenceTimer = setTimeout(() => {
          if (user.value && fid.value)
            request("/me/preferences", "POST", {
              familyId: fid.value,
              projectId: pid.value || null,
            }).catch(() => {});
        }, 600);
    }
  });
  return {
    user,
    families,
    projects,
    fid,
    pid,
    family,
    project,
    canWrite,
    isAdmin,
    base,
    ready,
    failure,
    modal,
    editing,
    toast,
    undoAction,
    notify,
    open,
    close,
    clear,
    bootstrap,
    loadFamilies,
    loadProjects,
  };
});
