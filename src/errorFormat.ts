import { ChatModelProviders } from "@/constants";

const V1_BASE_URL = /\/v1(\/|$)/;
const HTTP_404 = /\b404\b/;

export interface ModelEndpoint {
  provider?: string;
  baseUrl?: string;
}

export function withV1BaseHint(message: string, model: ModelEndpoint | null | undefined): string {
  const baseUrl = model?.baseUrl?.trim();
  if (!baseUrl || model?.provider !== ChatModelProviders.OPENAI_FORMAT) return message;
  if (V1_BASE_URL.test(baseUrl) || !HTTP_404.test(message)) return message;
  const suggested = baseUrl.replace(/\/+$/, "") + "/v1";
  return (
    message +
    `\nHint: the server answered 404. If it serves the OpenAI API under /v1, set the Base URL to ${suggested}.`
  );
}

export function err2String(err: unknown, stack = false): string {
  try {
    if (err instanceof Error) {
      const cause = (err as { cause?: unknown }).cause;
      const causeMsg =
        cause instanceof Error
          ? cause.message
          : cause != null
            ? typeof cause === "string"
              ? cause
              : (JSON.stringify(cause) ?? "")
            : "";
      const stackStr = stack && err.stack ? err.stack : "";
      const parts = [err.message];
      if (causeMsg) parts.push(`more message: ${causeMsg}`);
      if (stackStr) parts.push(stackStr);
      return parts.join("\n");
    }
    const json = JSON.stringify(err);
    return json ?? String(err);
  } catch {
    return String(err);
  }
}
