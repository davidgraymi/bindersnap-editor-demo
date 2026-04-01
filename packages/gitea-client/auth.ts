import type { User } from 'gitea-js';

import { createGiteaClient, GiteaApiError, type GiteaClient } from './client';

const TOKEN_STORAGE_KEY = 'bindersnap_gitea_token';

export interface GiteaUser {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
}

export class UnauthenticatedError extends Error {
  constructor(message = 'No Gitea token found in sessionStorage.') {
    super(message);
    this.name = 'UnauthenticatedError';
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
    login: user.login ?? '',
    full_name: user.full_name ?? '',
    email: user.email ?? '',
    avatar_url: user.avatar_url ?? '',
  };
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeResponse = error as {
      error?: unknown;
      message?: unknown;
      statusText?: unknown;
    };

    if (typeof maybeResponse.error === 'string' && maybeResponse.error.trim() !== '') {
      return maybeResponse.error;
    }

    if (typeof maybeResponse.message === 'string' && maybeResponse.message.trim() !== '') {
      return maybeResponse.message;
    }

    if (
      typeof maybeResponse.error === 'object' &&
      maybeResponse.error !== null &&
      'message' in maybeResponse.error &&
      typeof (maybeResponse.error as { message?: unknown }).message === 'string'
    ) {
      return (maybeResponse.error as { message: string }).message;
    }

    if (typeof maybeResponse.statusText === 'string' && maybeResponse.statusText.trim() !== '') {
      return maybeResponse.statusText;
    }
  }

  return 'Gitea request failed.';
}

function toGiteaApiError(error: unknown): GiteaApiError {
  if (error instanceof GiteaApiError) {
    return error;
  }

  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return new GiteaApiError(Number.isFinite(status) ? status : 0, readErrorMessage(error));
  }

  return new GiteaApiError(0, readErrorMessage(error));
}

export async function validateToken(baseUrl: string, token: string): Promise<GiteaUser> {
  try {
    const client = createGiteaClient(baseUrl, token);
    const { data } = await client.user.userGetCurrent();
    return normalizeGiteaUser(data);
  } catch (error) {
    throw toGiteaApiError(error);
  }
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

  if (!token || token.trim() === '') {
    throw new UnauthenticatedError();
  }

  return createGiteaClient(baseUrl, token);
}
