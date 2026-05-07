import type { components } from "./spec/gitea";

import {
  createGiteaClient,
  GiteaApiError,
  unwrap,
  type GiteaClient,
} from "./client";

type User = components["schemas"]["User"];

const TOKEN_STORAGE_KEY = "bindersnap_gitea_token";

export interface GiteaUser {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
}

export class UnauthenticatedError extends Error {
  constructor(message = "No Gitea token found in sessionStorage.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

function getSessionStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeGiteaUser(user: User): GiteaUser {
  return {
    id: user.id ?? 0,
    login: user.login ?? "",
    full_name: user.full_name ?? "",
    email: user.email ?? "",
    avatar_url: user.avatar_url ?? "",
  };
}

export async function validateToken(
  baseUrl: string,
  token: string,
): Promise<GiteaUser> {
  const client = createGiteaClient(baseUrl, token);
  const user = await unwrap(client.GET("/user"));
  return normalizeGiteaUser(user);
}

export function storeToken(token: string): void {
  getSessionStorage()?.setItem(TOKEN_STORAGE_KEY, token);
}

export function getStoredToken(): string | null {
  return getSessionStorage()?.getItem(TOKEN_STORAGE_KEY) ?? null;
}

export function clearToken(): void {
  getSessionStorage()?.removeItem(TOKEN_STORAGE_KEY);
}

export function createAuthenticatedClient(baseUrl: string): GiteaClient {
  const token = getStoredToken();

  if (!token || token.trim() === "") {
    throw new UnauthenticatedError();
  }

  return createGiteaClient(baseUrl, token);
}
