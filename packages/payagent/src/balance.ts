/**
 * payagent — On-chain USDC balance helper.
 *
 * Reads the USDC ERC-20 `balanceOf(address)` directly from an RPC.
 * Useful when you want an authoritative on-chain check independent
 * of any backend (e.g. ArisPay's balance endpoint is unreachable).
 */
import { Contract, JsonRpcProvider } from "ethers";

/**
 * USDC contract addresses per chain.
 *
 * Canonical source is `@arispay/x402-core` (USDC_BASE_MAINNET, etc.).
 * This duplicate is intentional: `payagent` is a published, standalone npm
 * package and must NOT take a workspace dep on the private `@arispay/x402-core`
 * package — npm consumers wouldn't resolve it. Keep these four values in sync
 * with packages/x402-core/src/constants.ts by hand. Do not try to "DRY" by
 * importing — see P2-4 blocker discussion.
 */
export const USDC_CONTRACTS: Record<string, string> = {
  // Base
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  // Ethereum
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  // Polygon
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};

/** Default public RPCs. Callers should pass their own for production. */
const DEFAULT_RPCS: Record<string, string> = {
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
  ethereum: "https://eth.llamarpc.com",
  polygon: "https://polygon-rpc.com",
};

const ERC20_BALANCE_ABI = ["function balanceOf(address) view returns (uint256)"];

/**
 * Fetch the USDC balance for a wallet on the given chain.
 *
 * @param walletAddress EVM address (0x…).
 * @param chain One of 'base' | 'base-sepolia' | 'ethereum' | 'polygon'. Default: 'base'.
 * @param rpcUrl Optional RPC URL override. Falls back to a public endpoint.
 * @returns USDC balance in 6-decimal base units as a bigint.
 */
export async function getUSDCBalance(
  walletAddress: string,
  chain: keyof typeof USDC_CONTRACTS = "base",
  rpcUrl?: string,
): Promise<bigint> {
  const contractAddress = USDC_CONTRACTS[chain];
  if (!contractAddress) {
    throw new Error(`getUSDCBalance: unsupported chain "${chain}"`);
  }
  const url = rpcUrl ?? DEFAULT_RPCS[chain];
  if (!url) {
    throw new Error(`getUSDCBalance: no RPC for chain "${chain}" — pass rpcUrl explicitly`);
  }

  const provider = new JsonRpcProvider(url);
  const usdc = new Contract(contractAddress, ERC20_BALANCE_ABI, provider);
  const raw = (await usdc.balanceOf(walletAddress)) as bigint;
  return raw;
}

/** Format a USDC base-unit bigint (6 decimals) as a human-readable string, e.g. "1.234567". */
export function formatUSDC(baseUnits: bigint): string {
  const s = baseUnits.toString().padStart(7, "0");
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
