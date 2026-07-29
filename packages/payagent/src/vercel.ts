/**
 * payagent/vercel — Vercel AI SDK tool integration.
 *
 * @example
 * ```ts
 * import { createPayAgentTool } from 'payagent/vercel';
 * import { generateText } from 'ai';
 *
 * const payTool = createPayAgentTool({
 *   arispayUrl: 'https://api.arispay.app',
 *   apiKey: process.env.ARISPAY_AGENT_KEY,
 * });
 *
 * const { text } = await generateText({
 *   model: yourModel,
 *   tools: { pay_api: payTool },
 *   prompt: 'Fetch the premium weather data from ...',
 * });
 * ```
 */
import { type Tool, tool } from "ai";
import { z } from "zod/v4";
import { type PayFetchDelegatedConfig, payFetchDelegated } from "./fetch-delegated.js";
import { type PayFetchLocalConfig, payFetchLocal } from "./fetch-local.js";

/** Delegated (ArisPay custody, server-enforced limits) or local (permissionless) config. */
export type PayAgentToolConfig = PayFetchDelegatedConfig | PayFetchLocalConfig;

const inputSchema = z.object({
  url: z.string().describe("The full URL of the API endpoint to call"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP method"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Additional HTTP headers to include"),
  body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
});

type Input = z.infer<typeof inputSchema>;

interface PayApiResult {
  status: number;
  body: string;
}

/**
 * Create a Vercel AI SDK tool that lets an AI agent make paid API calls.
 * Handles HTTP 402 payment challenges automatically using USDC via the x402
 * protocol. With `arispayUrl` + `apiKey` it signs via ArisPay's delegated
 * custody (server-enforced spend caps); with `privateKey` it signs locally
 * (permissionless — no ArisPay account, no server-enforced limits).
 */
export function createPayAgentTool(config: PayAgentToolConfig): Tool<Input, PayApiResult> {
  const fetch402 = "privateKey" in config ? payFetchLocal(config) : payFetchDelegated(config);

  return tool<Input, PayApiResult>({
    description:
      "Make an HTTP request to a paid API. Automatically handles HTTP 402 payment " +
      "challenges by signing USDC payments via the x402 protocol. Use this instead of " +
      "regular fetch when you expect the API might require payment.",
    inputSchema,
    execute: async ({ url, method, headers, body }) => {
      const response = await fetch402(url, {
        method,
        headers: headers as Record<string, string> | undefined,
        body,
      });

      const responseBody = await response.text();

      return {
        status: response.status,
        body: responseBody,
      };
    },
  });
}
