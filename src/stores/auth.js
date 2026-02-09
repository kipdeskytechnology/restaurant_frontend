// src/stores/auth.js
import { defineStore } from "pinia";
import http from "../api/http";
import { jwtDecode } from "jwt-decode";

const readAccessToken = () =>
  localStorage.getItem("access_token") || sessionStorage.getItem("access_token");

const readRefreshToken = () =>
  localStorage.getItem("refresh_token") || sessionStorage.getItem("refresh_token");

export const useAuthStore = defineStore("auth", {
  state: () => ({
    me: null,
    accessToken: readAccessToken(),
    refreshToken: readRefreshToken(),
  }),

  getters: {
    isAuthed: (s) => !!s.accessToken,

    claims: (s) => {
      if (!s.accessToken) return null;
      try {
        return jwtDecode(s.accessToken);
      } catch {
        return null;
      }
    },

    permissions: (s) => new Set(s.me?.permissions || []),
    hasPerm: (s) => (code) => (s.me?.permissions || []).includes(code),
    hasRole: (s) => (roleName) => (s.me?.roles || []).includes(roleName),
  },

  actions: {
    setTokens(access, refresh, remember = true) {
      const store = remember ? localStorage : sessionStorage;
      const other = remember ? sessionStorage : localStorage;

      other.removeItem("access_token");
      other.removeItem("refresh_token");

      store.setItem("access_token", access);
      store.setItem("refresh_token", refresh);

      // ✅ reactive
      this.accessToken = access;
      this.refreshToken = refresh;
    },

    clearTokens() {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("refresh_token");

      // ✅ reactive
      this.accessToken = null;
      this.refreshToken = null;
      this.me = null;
    },

    async login(identifier, password, remember = true) {
      const res = await http.post("/auth/login", { identifier, password });

      this.setTokens(res.data.access_token, res.data.refresh_token, remember);

      await this.fetchMe();
      return res.data;
    },

    async fetchMe() {
      const res = await http.get("/auth/me");
      this.me = res.data;
      return this.me;
    },

    async logout() {
      const rt = this.refreshToken;
      try {
        if (rt) await http.post("/auth/logout", { refresh_token: rt });
      } catch (_) {}

      this.clearTokens();
    },
  },
});