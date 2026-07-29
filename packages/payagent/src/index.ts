/**
 * payagent — Let AI agents pay for APIs.
 *
 * Drop-in fetch wrapper that handles HTTP 402 payments with USDC stablecoins
 * via the x402 protocol, using ArisPay's delegated-custody model. No private
 * key ever lives in your process — ArisPay holds a Coinbase CDP-managed
 * wallet and enforces spend limits server-side.
 *
 * @example
 * ```ts
 * import { DelegationClient, payFetchDelegated } from 'payagent';
 *
 * // 1. Provision an agent once. ArisPay mints a CDP wallet and returns an
 * //    agent-scoped API key (returned exactly once).
 * const client = new DelegationClient('https://api.arispay.app', process.env.ARISPAY_KEY);
 * const agent = await client.createX402Agent({
 *   name: 'my-agent',
 *   maxPerTx: 100,      // cents — $1.00 cap per request
 *   maxDaily: 1000,     // $10 / day
 *   maxMonthly: 10000,  // $100 / month
 *   allowedDomains: ['api.example.com'],
 * });
 *
 * // 2. Fund the wallet address with USDC on Base, then wait for it to latch.
 * await client.pollUntilFunded(agent.agentId);
 *
 * // 3. Make paid requests. 402s are handled transparently.
 * const fetch402 = payFetchDelegated({
 *   arispayUrl: 'https://api.arispay.app',
 *   apiKey: agent.apiKey,
 * });
 * const res = await fetch402('https://api.example.com/premium');
 * ```
 */

// Primary API — delegated signing via ArisPay
export { payFetchDelegated } from "./fetch-delegated.js";
export type {
  DelegatedPaymentInfo,
  PayFetchDelegatedConfig,
  PayFetchFn,
} from "./fetch-delegated.js";
// Permissionless mode — local signing, no ArisPay account required
export { payFetchLocal } from "./fetch-local.js";
export type { LocalPaymentInfo, PayFetchLocalConfig } from "./fetch-local.js";
export { DelegationClient, HostedTopupNotConfiguredError } from "./delegation.js";
export type {
  X402AgentConfig,
  CreateX402AgentResponse,
  BalanceResponse,
  AgentSummary,
  ListAgentsOptions,
  ListAgentsResponse,
  RenameAgentResponse,
  UpdateAgentPatch,
  UpdateAgentResponse,
  PaymentFeedItem,
  PaymentsFeedResponse,
  PaymentsFeedQueryOptions,
  HostedTopupOptions,
  HostedTopupResponse,
  EndUserResponse,
  CreateEndUserOptions,
  CardSetupSessionResponse,
  CardSetupStatus,
  CardSetupStatusResponse,
  WalletChain,
  AttachWalletOptions,
  WalletPaymentMethodResponse,
  WalletStatusResponse,
  SetUserLimitsOptions,
  SpendLimitResponse,
  CreatePaymentOptions,
  PaymentResponse,
  PaymentSpendInfo,
  PaymentStatus,
  PaymentRail,
  PaymentNextAction,
} from "./delegation.js";

// Server-authoritative wallet listing + local-cache sync. Use this from
// CLI/MCP listing surfaces — it eliminates the "new machine, blind to my
// wallets" failure mode that pure local-cache reads can't avoid.
export { syncAgents, MissingDevKeyForSyncError } from "./sync-agents.js";
export type { SyncAgentsOptions, SyncedAgent, SyncAgentsResult } from "./sync-agents.js";

// Headless launch sugar — one call to provision + wrap + persist.
export { launchAgent, getLaunchedAgent, MissingArisPayApiKeyError } from "./launch.js";
export type { LaunchAgentConfig, LaunchedAgent } from "./launch.js";

// Cold-start primitive: signup + agent + (optional) Onramp URL in one call.
// No prior ArisPay credentials required. Persists results to ~/.payagent/config.json.
export { bootstrapAgent, BootstrapError } from "./bootstrap.js";
export type {
  BootstrapAgentConfig,
  BootstrapAgentResult,
  BootstrapExistingAgent,
  BootstrapPairing,
} from "./bootstrap.js";

// Device-code OAuth flow — the `payagent init` primitive, re-exported so the
// MCP server can share it.
export {
  requestDeviceCode,
  pollDeviceToken,
  runDeviceAuth,
  DeviceCodeError,
} from "./device-code.js";
export type { DeviceCodeResponse, DeviceTokenResponse } from "./device-code.js";

// Local config store — shared by the CLI and the MCP server.
export {
  loadConfig,
  saveConfig,
  getApiKey,
  getArispayUrl,
  setApiKey,
  clearApiKey,
  saveAgent,
  getAgent,
  listAgents,
  removeAgent,
  upsertManyFromServer,
  renameStoredAgent,
  getConfigPath,
  DEFAULT_ARISPAY_URL,
} from "./config-store.js";
export type { StoredAgent, StoredConfig } from "./config-store.js";

// On-chain balance helper
export { getUSDCBalance, formatUSDC, USDC_CONTRACTS } from "./balance.js";

// Marketplace discovery — capability-indexed + budget-bounded search for agents.
// Wraps `POST /v1/marketplace/discover`. Use the returned candidate's
// `endpoint.url` with `payFetchDelegated` to issue the paid call.
export { discover } from "./discover.js";
export type {
  DiscoverInput,
  DiscoverResult,
  DiscoverCandidate,
  DiscoverEndpoint,
  DiscoverPricing,
  DiscoverTransport,
  DiscoverCategory,
  DiscoverSource,
  DiscoverOptions,
} from "./discover.js";

// Read-only x402 challenge inspection — fetch a URL without paying to see
// its price, asset, network, and payment requirements. Never sends money.
export { inspectChallenge, centsFromBaseUnits, InspectParseError } from "./inspect.js";
export type {
  InspectChallengeResult,
  InspectChallengeOptions,
  InspectedAccept,
} from "./inspect.js";

// Types
export type {
  PaymentReceipt,
  X402Requirements,
  X402Accept,
  AgfacFlatRequirements,
  PaymentRequirementsBody,
} from "./types.js";

// Errors
export {
  PayAgentError,
  PaymentRejectedError,
  InvalidRequirementsError,
} from "./errors.js";
