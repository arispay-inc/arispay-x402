/**
 * payagent/langchain — LangChain tool integration.
 *
 * @example
 * ```ts
 * import { createPayAgentTool } from 'payagent/langchain';
 *
 * const payTool = createPayAgentTool({
 *   arispayUrl: 'https://api.arispay.app',
 *   apiKey: process.env.ARISPAY_AGENT_KEY,
 * });
 *
 * const agent = createToolCallingAgent({ llm, tools: [payTool], prompt });
 * ```
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod/v3";
import { type PayFetchDelegatedConfig, payFetchDelegated } from "./fetch-delegated.js";
import { type PayFetchLocalConfig, payFetchLocal } from "./fetch-local.js";

/** Delegated (ArisPay custody, server-enforced limits) or local (permissionless) config. */
export type PayAgentToolConfig = PayFetchDelegatedConfig | PayFetchLocalConfig;

/**
 * Create a LangChain tool that lets an AI agent make paid API calls.
 * Handles HTTP 402 payment challenges automatically using USDC via the x402
 * protocol. With `arispayUrl` + `apiKey` it signs via ArisPay's delegated
 * custody (server-enforced spend caps); with `privateKey` it signs locally
 * (permissionless — no ArisPay account, no server-enforced limits).
 */
export function createPayAgentTool(config: PayAgentToolConfig) {
  const fetch402 = "privateKey" in config ? payFetchLocal(config) : payFetchDelegated(config);

  const schema = z.object({
    url: z.string().describe("The full URL of the API endpoint to call"),
    method: z
      .enum(["GET", "POST", "PUT", "DELETE", "PATCH"])
      .default("GET")
      .describe("HTTP method"),
    headers: z.record(z.string()).optional().describe("Additional HTTP headers to include"),
    body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
  });

  return new DynamicStructuredTool({
    name: "pay_api",
    description:
      "Make an HTTP request to a paid API. Automatically handles HTTP 402 payment " +
      "challenges by signing USDC payments via the x402 protocol. Use this instead of " +
      "regular fetch when you expect the API might require payment.",
    schema,
    func: async ({ url, method, headers, body }) => {
      const response = await fetch402(url, {
        method,
        headers,
        body,
      });

      const responseBody = await response.text();

      return JSON.stringify({
        status: response.status,
        body: responseBody,
      });
    },
  });
}
