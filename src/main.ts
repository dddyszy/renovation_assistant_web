import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "./style.css";

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved || { top: 0 },
  routes: [
    { path: "/login", component: () => import("./views/AuthView.vue") },
    { path: "/register", component: () => import("./views/AuthView.vue") },
    {
      path: "/reset-password",
      component: () => import("./views/AuthView.vue"),
    },
    {
      path: "/invite/:token",
      component: () => import("./views/InviteView.vue"),
    },
    { path: "/", component: () => import("./views/OverviewView.vue") },
    { path: "/ledger", component: () => import("./views/LedgerView.vue") },
    {
      path: "/materials",
      component: () => import("./views/MaterialsView.vue"),
    },
    { path: "/stages", component: () => import("./views/StagesView.vue") },
    { path: "/notes", component: () => import("./views/NotesView.vue") },
    {
      path: "/statistics",
      component: () => import("./views/StatisticsView.vue"),
    },
    { path: "/family", component: () => import("./views/FamilyView.vue") },
    { path: "/me", component: () => import("./views/ProfileView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
createApp(App)
  .use(createPinia())
  .use(router)
  .use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: true },
      },
    },
  })
  .mount("#app");
if (import.meta.env.PROD && "serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
