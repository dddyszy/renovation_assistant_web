import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { router } from "./router";
import App from "./App.vue";
import "./styles/index.css";

const app = createApp(App)
  .use(createPinia())
  .use(router)
  .use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: true },
      },
    },
  });
// Wait for the first route so public share links are not mistaken for protected pages.
router.isReady().then(() => app.mount("#app"));
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
