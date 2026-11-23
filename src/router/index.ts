import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved || { top: 0 },
  routes: [
    { path: "/login", component: () => import("../views/AuthView.vue") },
    { path: "/register", component: () => import("../views/AuthView.vue") },
    {
      path: "/reset-password",
      component: () => import("../views/AuthView.vue"),
    },
    {
      path: "/invite/:token",
      component: () => import("../views/InviteView.vue"),
    },
    {
      path: "/share/note/:token",
      component: () => import("../views/SharedNoteView.vue"),
    },
    {
      path: "/share/column/:token",
      component: () => import("../views/SharedColumnView.vue"),
    },
    { path: "/", component: () => import("../views/OverviewView.vue") },
    { path: "/ledger", component: () => import("../views/LedgerView.vue") },
    {
      path: "/materials",
      component: () => import("../views/MaterialsView.vue"),
    },
    { path: "/stages", component: () => import("../views/StagesView.vue") },
    { path: "/notes", component: () => import("../views/NotesView.vue") },
    {
      path: "/statistics",
      component: () => import("../views/StatisticsView.vue"),
    },
    { path: "/family", component: () => import("../views/FamilyView.vue") },
    { path: "/me", component: () => import("../views/ProfileView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
