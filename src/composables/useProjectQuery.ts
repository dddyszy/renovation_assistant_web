import type { ProjectResources } from "../../shared/api";
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useWorkspace } from "../stores/workspace";
import { request } from "../services/api";
export function useProjectQuery<K extends keyof ProjectResources>(resource: K) {
  const w = useWorkspace();
  return useQuery({
    queryKey: computed(() => ["project", w.fid, w.pid, resource]),
    enabled: computed(() => !!w.user && !!w.project),
    queryFn: () => request<ProjectResources[K]>(`${w.base}/${resource}`),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}
