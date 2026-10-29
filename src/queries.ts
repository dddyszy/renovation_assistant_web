import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useWorkspace } from "./workspace";
import { request } from "./api";
export function useProjectQuery(resource: string) {
  const w = useWorkspace();
  return useQuery({
    queryKey: computed(() => ["project", w.fid, w.pid, resource]),
    enabled: computed(() => !!w.user && !!w.project),
    queryFn: () => request(`${w.base}/${resource}`),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}
