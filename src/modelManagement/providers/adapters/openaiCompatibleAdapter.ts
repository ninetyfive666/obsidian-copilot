import * as z from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import { probeChatRoute } from "./chatRouteProbe";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";

const extrasSchema = z
  .object({
    openAIOrgId: z.string().optional(),
  })
  .strict();

type Extras = z.infer<typeof extrasSchema>;

export const openaiCompatibleAdapter: ProviderAdapter<Extras> = {
  providerType: "openai-compatible",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error(
      "[modelManagement] openaiCompatibleAdapter.buildLangChainClient not implemented yet"
    );
  },

  async verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    const baseUrl = ctx.provider.baseUrl?.trim();
    if (!baseUrl) {
      return {
        ok: false,
        code: "missing_base_url",
        message: "A base URL is required to verify this OpenAI-compatible provider.",
        checkedAt: Date.now(),
      };
    }
    const base = baseUrl.replace(/\/$/, "");

    const headers: Record<string, string> = {};
    if (ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }
    if (ctx.extras.openAIOrgId) {
      headers["OpenAI-Organization"] = ctx.extras.openAIOrgId;
    }

    const listResult = await verifyViaListModels(`${base}/models`, headers);
    if (!listResult.ok) return listResult;

    const probe = await probeChatRoute(base, headers);
    if (probe.needsV1) {
      return {
        ok: false,
        code: "chat_route_needs_v1",
        message: `The model list is reachable, but the chat API is only served under /v1. Use "${probe.suggestedBaseUrl}" as the Base URL.`,
        checkedAt: Date.now(),
      };
    }
    return listResult;
  },
};
