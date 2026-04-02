import { giteaApi } from "gitea-js";

export function createGiteaClient(baseUrl: string, token: string) {
  return giteaApi(baseUrl, { token });
}

export type GiteaClient = ReturnType<typeof createGiteaClient>;

export class GiteaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GiteaApiError";
  }
}
