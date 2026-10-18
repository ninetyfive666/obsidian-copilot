import { ProviderInfo } from "@/constants";
import type { Provider } from "@/constants";

export { err2String } from "@/errorFormat";

export function getProviderLabel(provider: string): string {
  return ProviderInfo[provider as Provider]?.label || provider;
}
