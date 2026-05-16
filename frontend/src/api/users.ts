import { api } from "./client";
import type { User } from "./auth";

export type Role = "readonly" | "operator" | "admin";

export function listUsers() {
  return api<User[]>("GET", "/api/users");
}

export function createUser(req: { username: string; password: string; role: Role }) {
  return api<User>("POST", "/api/users", req);
}

export function updateUser(
  id: string,
  req: { role?: Role; password?: string },
) {
  return api<User>("PATCH", `/api/users/${id}`, req);
}

export function deleteUser(id: string) {
  return api<void>("DELETE", `/api/users/${id}`);
}

export function changePassword(current_password: string, new_password: string) {
  return api<void>("POST", "/api/auth/change-password", {
    current_password,
    new_password,
  });
}
