// The one part of Cloudflare's runtime module this Worker uses. Declared here
// rather than pulling in @cloudflare/workers-types for a single class.
declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
  }
}
