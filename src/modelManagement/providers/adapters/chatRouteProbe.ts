import { fetchWithListModelsTimeout } from "./listModelsHttp";

export type ChatRouteProbe = { needsV1: false } | { needsV1: true; suggestedBaseUrl: string };

const V1_IN_BASE = /\/v1(\/|$)/;
const CHAT_COMPLETIONS_PATH = "/chat/completions";

type RouteState = "present" | "missing" | "ambiguous";

function routeState(status: number): RouteState {
  if ((status >= 200 && status < 300) || status === 405) return "present";
  if (status === 404) return "missing";
  return "ambiguous";
}

async function probePath(
  url: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<RouteState> {
  const response = await fetchWithListModelsTimeout(url, { method: "GET", headers }, timeoutMs);
  return routeState(response.status);
}

export async function probeChatRoute(
  base: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<ChatRouteProbe> {
  if (!base || V1_IN_BASE.test(base)) {
    return { needsV1: false };
  }
  try {
    if ((await probePath(`${base}${CHAT_COMPLETIONS_PATH}`, headers, timeoutMs)) !== "missing") {
      return { needsV1: false };
    }
    const underV1 = await probePath(`${base}/v1${CHAT_COMPLETIONS_PATH}`, headers, timeoutMs);
    if (underV1 === "present") {
      return { needsV1: true, suggestedBaseUrl: `${base}/v1` };
    }
    return { needsV1: false };
  } catch {
    return { needsV1: false };
  }
}
