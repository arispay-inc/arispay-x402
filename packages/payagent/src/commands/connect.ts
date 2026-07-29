/* eslint-disable no-console */
/**
 * `payagent connect <CODE>` — link an existing BuyForMe wallet to the
 * local PayAgent config.
 *
 * The user generates a short-lived pairing code from the BuyForMe wallet
 * detail page, then runs this command on their computer. The command
 * exchanges the code for wallet config + an agent-scoped API key and
 * writes them to `~/.payagent/config.json`. No new wallet is created.
 */
import { getArispayUrl, loadConfig, saveAgent, saveConfig } from "../config-store.js";
import type { StoredAgent } from "../config-store.js";

interface WalletExchangeResponse {
  agentId: string;
  agentName: string;
  apiKey: string;
  walletAddress: string;
  network: string;
  arispayUrl: string;
  limits: {
    perTx: number;
    daily: number;
    monthly: number;
  };
  allowedDomains: string[];
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export async function cmdConnect(args: string[]): Promise<void> {
  const rawCode = args[0];
  if (!rawCode) {
    console.error("Usage: payagent connect <CODE>");
    console.error("");
    console.error("  Connect an existing BuyForMe wallet to this computer.");
    console.error('  Get the code from your wallet\'s "Connect to your AI" section.');
    process.exit(1);
  }

  // Normalize: strip dashes/spaces, uppercase
  const code = rawCode.replace(/[\s-]/g, "").toUpperCase();

  const arispayUrl = getArispayUrl();
  console.log(`Exchanging pairing code with ${arispayUrl}...`);

  const res = await fetch(`${arispayUrl.replace(/\/$/, "")}/v1/auth/pair/wallet-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const body = await safeJson(res);
    const errCode = body?.error?.code ?? "";
    const message = body?.error?.message ?? `Request failed (${res.status})`;

    if (errCode === "PairingCodeExpiredError") {
      console.error("That pairing code has expired. Generate a new one from your wallet.");
    } else if (errCode === "PairingCodeAlreadyConsumedError") {
      console.error(
        "That pairing code has already been used. Generate a new one from your wallet.",
      );
    } else if (errCode === "PairingCodeNotFoundError") {
      console.error("Pairing code not found. Check the code and try again.");
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }

  const data: WalletExchangeResponse = await res.json();

  // Persist the agent to the local config
  const agent: StoredAgent = {
    agentId: data.agentId,
    name: data.agentName,
    walletAddress: data.walletAddress,
    apiKey: data.apiKey,
    limits: data.limits,
    allowedDomains: data.allowedDomains,
    network: data.network as StoredAgent["network"],
    createdAt: new Date().toISOString(),
  };

  saveAgent(agent);

  // Also persist the developer key if we don't have one yet, and
  // save the arispayUrl if it was overridden
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    saveConfig({ ...cfg, apiKey: data.apiKey });
  }
  if (data.arispayUrl && data.arispayUrl !== "https://api.arispay.app" && !cfg.arispayUrl) {
    const updated = loadConfig();
    saveConfig({ ...updated, arispayUrl: data.arispayUrl });
  }

  console.log("");
  console.log(
    `Connected wallet "${data.agentName}" (${data.walletAddress.slice(0, 6)}...${data.walletAddress.slice(-4)})`,
  );
  console.log(`  Network: ${data.network}`);
  console.log(
    `  Limits:  $${(data.limits.perTx / 100).toFixed(2)}/tx, $${(data.limits.daily / 100).toFixed(2)}/day, $${(data.limits.monthly / 100).toFixed(2)}/mo`,
  );
  console.log("");
  console.log("Your AI tools that read ~/.payagent/config.json (MCP servers, Claude Code)");
  console.log("will automatically use this wallet. No further setup needed.");
}

async function safeJson(res: Response): Promise<ApiErrorBody | undefined> {
  try {
    return (await res.clone().json()) as ApiErrorBody;
  } catch {
    return undefined;
  }
}
