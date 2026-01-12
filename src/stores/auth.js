// src/stores/auth.js
import { defineStore } from "pinia";
import http from "../api/http";
import { jwtDecode } from "jwt-decode";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    me: null,
  }),

  getters: {
    isAuthed: () =>
      !!localStorage.getItem("access_token") || !!sessionStorage.getItem("access_token"),

    claims: () => {
      const t =
        localStorage.getItem("access_token") || sessionStorage.getItem("access_token");
      if (!t) return null;
      try {
        return jwtDecode(t);
      } catch {
        return null;
      }
    },

    permissions: (s) => new Set(s.me?.permissions || []),
    hasPerm: (s) => (code) => (s.me?.permissions || []).includes(code),
    hasRole: (s) => (roleName) => (s.me?.roles || []).includes(roleName),
  },

  actions: {
    async login(identifier, password, remember = true) {
      const res = await http.post("/auth/login", { identifier, password });

      const store = remember ? localStorage : sessionStorage;
      const other = remember ? sessionStorage : localStorage;

      // clear the other storage so you don't get mixed tokens
      other.removeItem("access_token");
      other.removeItem("refresh_token");

      store.setItem("access_token", res.data.access_token);
      store.setItem("refresh_token", res.data.refresh_token);

      await this.fetchMe();
      return res.data;
    },

    async fetchMe() {
      const res = await http.get("/auth/me");
      this.me = res.data;
      return this.me;
    },

    async logout() {
      const rt =
        localStorage.getItem("refresh_token") || sessionStorage.getItem("refresh_token");

      try {
        if (rt) await http.post("/auth/logout", { refresh_token: rt });
      } catch (_) {}

      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("refresh_token");

      this.me = null;
    },

    async changePassword(payload) {
      return http.post("/auth/change-password", payload);
    },

    async requestPasswordReset(identifier) {
      return http.post("/auth/forgot-password", { identifier });
    },
    
    async resetPassword(token, new_password) {
      return http.post("/auth/reset-password", { token, new_password });
    }
  },
});
