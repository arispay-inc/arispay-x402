/**
 * payagent — OAuth device-code flow consumer.
 *
 * Lets a headless client (the `payagent` CLI or the MCP server) obtain an
 * ArisPay developer API key without a redirect. The flow:
 *
 *   1. Client calls `POST /v1/auth/device/code` and prints the `userCode`
 *      + `verificationUrl` to the user.
 *   2. User opens the URL in a browser, signs in to the ArisPay dashboard,
 *      and enters the code.
 *   3. Client polls `POST /v1/auth/device/token` every `interval` seconds
 *      until the server returns `{ accessToken, email, environment }`
 *      (on success) or a terminal error (`access_denied`, `expired_token`).
 *
 * Matches the RFC 8628 shape but uses ArisPay's conventional error body
 * `{ error: { code, message } }` rather than the OAuth `{ error }` string.
 */

import { DEFAULT_ARISPAY_URL } from "./config-store.js";

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds until `deviceCode` expires server-side. */
  expiresIn: number;
  /** Minimum seconds between polls per the server. */
  interval: number;
}

export interface DeviceTokenResponse {
  accessToken: string;
  email?: string;
  environment?: "production" | "sandbox";
}

/** Error codes the `/token` endpoint may return while still useful to keep polling. */
const PENDING_CODES = new Set(["authorization_pending", "slow_down"]);
/** Error codes that mean give up. */
const TERMINAL_CODES = new Set(["access_denied", "expired_token"]);

export class DeviceCodeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceCodeError";
    this.code = code;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Request a new device code from ArisPay. Resolves with the code + verification
 * URL the user must visit.
 */
export async function requestDeviceCode(
  options: {
    arispayUrl?: string;
    clientId?: string;
  } = {},
): Promise<DeviceCodeResponse> {
  const baseUrl = (options.arispayUrl ?? DEFAULT_ARISPAY_URL).replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/v1/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: options.clientId ?? "payagent-cli" }),
  });
  if (!res.ok) {
    const body = (await safeJson(res)) as ApiErrorBody | undefined;
    const message = body?.error?.message ?? (await safeText(res)) ?? res.statusText;
    throw new DeviceCodeError(body?.error?.code ?? "device_code_request_failed", message);
  }
  return (await res.json()) as DeviceCodeResponse;
}

/**
 * Poll the token endpoint until the user approves the device code, or until
 * a terminal error is returned, or until `timeoutMs` elapses.
 *
 * `intervalMs` seeds the poll cadence; a `slow_down` error doubles it up to a
 * 60 s ceiling. The default comes from the server's `interval` in the initial
 * response — callers should normally pass that value.
 */
export async function pollDeviceToken(
  deviceCode: string,
  options: {
    arispayUrl?: string;
    clientId?: string;
    /** Initial interval between polls, in milliseconds. Default 5 s. */
    intervalMs?: number;
    /** Total timeout, in milliseconds. Default 10 minutes. */
    timeoutMs?: number;
    /** Invoked once per poll with the elapsed milliseconds. Useful for UI spinners. */
    onTick?: (elapsedMs: number) => void;
  } = {},
): Promise<DeviceTokenResponse> {
  const baseUrl = (options.arispayUrl ?? DEFAULT_ARISPAY_URL).replace(/\/$/, "");
  const clientId = options.clientId ?? "payagent-cli";
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const start = Date.now();
  let intervalMs = options.intervalMs ?? 5000;

  while (true) {
    const elapsed = Date.now() - start;
    options.onTick?.(elapsed);
    if (elapsed >= timeoutMs) {
      throw new DeviceCodeError(
        "device_code_timeout",
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for user to authorize`,
      );
    }

    const res = await fetch(`${baseUrl}/v1/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode, clientId }),
    });

    if (res.ok) {
      return (await res.json()) as DeviceTokenResponse;
    }

    const body = (await safeJson(res)) as ApiErrorBody | undefined;
    const code = body?.error?.code ?? "device_code_error";
    const message = body?.error?.message ?? res.statusText;

    if (code === "slow_down") {
      intervalMs = Math.min(intervalMs * 2, 60_000);
    } else if (!PENDING_CODES.has(code)) {
      // Terminal (access_denied / expired_token) or unknown — propagate.
      throw new DeviceCodeError(code, message);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * One-shot convenience: request a code, invoke `onCode` so the caller can
 * print the URL + user code to the terminal, then poll until approval.
 *
 * Returns the final `{ accessToken, email, environment }`.
 */
export async function runDeviceAuth(
  options: {
    arispayUrl?: string;
    clientId?: string;
    /** Receives the device-code info the moment it's issued. */
    onCode?: (info: DeviceCodeResponse) => void;
    /** Forwarded to `pollDeviceToken`. */
    pollTimeoutMs?: number;
    onTick?: (elapsedMs: number) => void;
  } = {},
): Promise<DeviceTokenResponse> {
  const code = await requestDeviceCode({
    arispayUrl: options.arispayUrl,
    clientId: options.clientId,
  });
  options.onCode?.(code);
  return pollDeviceToken(code.deviceCode, {
    arispayUrl: options.arispayUrl,
    clientId: options.clientId,
    intervalMs: code.interval * 1000,
    timeoutMs: options.pollTimeoutMs ?? code.expiresIn * 1000,
    onTick: options.onTick,
  });
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return undefined;
  }
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.clone().text();
  } catch {
    return undefined;
  }
}

export { TERMINAL_CODES, PENDING_CODES };
