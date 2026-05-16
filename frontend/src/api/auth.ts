import { api, apiPublic } from "./client";

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export type User = {
  id: string;
  username: string;
  role: string;
  created_at: string;
};

export function login(username: string, password: string) {
  return apiPublic<TokenPair>("POST", "/api/auth/login", { username, password });
}

export function me() {
  return api<User>("GET", "/api/auth/me");
}
