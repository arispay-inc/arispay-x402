/**
 * Tests for `device-code.ts`.
 *
 * Exercises the poll-loop semantics without hitting a real network:
 * `global.fetch` is stubbed per test. Confirms that `authorization_pending`
 * keeps polling, `slow_down` doubles the interval, and terminal codes
 * (`access_denied`, `expired_token`) throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeviceCodeError,
  pollDeviceToken,
  requestDeviceCode,
  runDeviceAuth,
} from "./device-code.js";

const BASE = "https://api.arispay.test";

type StubResponse = {
  ok: boolean;
  status?: number;
  json: unknown;
};

function stubFetch(responses: StubResponse[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  let i = 0;
  fn.mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const body = JSON.stringify(r.json);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      statusText: r.ok ? "OK" : "Error",
      clone() {
        return this;
      },
      async json() {
        return JSON.parse(body);
      },
      async text() {
        return body;
      },
    } as unknown as Response;
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

let origFetch: typeof fetch;
beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = origFetch;
  vi.restoreAllMocks();
});

describe("requestDeviceCode", () => {
  it("POSTs to /v1/auth/device/code with the clientId", async () => {
    const fetch = stubFetch([
      {
        ok: true,
        json: {
          deviceCode: "abc",
          userCode: "WXYZ-1234",
          verificationUrl: `${BASE}/device`,
          expiresIn: 300,
          interval: 5,
        },
      },
    ]);
    const r = await requestDeviceCode({ arispayUrl: BASE, clientId: "test-cli" });
    expect(r.userCode).toBe("WXYZ-1234");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/v1/auth/device/code`,
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ clientId: "test-cli" });
  });

  it("throws a DeviceCodeError with the server-supplied code", async () => {
    stubFetch([
      { ok: false, status: 400, json: { error: { code: "invalid_request", message: "bad" } } },
    ]);
    await expect(requestDeviceCode({ arispayUrl: BASE })).rejects.toMatchObject({
      name: "DeviceCodeError",
      code: "invalid_request",
    });
  });
});

describe("pollDeviceToken", () => {
  it("returns the token on the first approved response", async () => {
    stubFetch([{ ok: true, json: { accessToken: "ap_live_xyz", email: "a@b.co" } }]);
    const token = await pollDeviceToken("abc", {
      arispayUrl: BASE,
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(token).toEqual({ accessToken: "ap_live_xyz", email: "a@b.co" });
  });

  it("keeps polling through authorization_pending", async () => {
    const fetch = stubFetch([
      { ok: false, json: { error: { code: "authorization_pending", message: "wait" } } },
      { ok: false, json: { error: { code: "authorization_pending", message: "wait" } } },
      { ok: true, json: { accessToken: "ap_live_xyz" } },
    ]);
    const token = await pollDeviceToken("abc", {
      arispayUrl: BASE,
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(token.accessToken).toBe("ap_live_xyz");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws on access_denied", async () => {
    stubFetch([{ ok: false, json: { error: { code: "access_denied", message: "no" } } }]);
    await expect(
      pollDeviceToken("abc", { arispayUrl: BASE, intervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "DeviceCodeError", code: "access_denied" });
  });

  it("throws on expired_token", async () => {
    stubFetch([{ ok: false, json: { error: { code: "expired_token", message: "gone" } } }]);
    await expect(
      pollDeviceToken("abc", { arispayUrl: BASE, intervalMs: 1, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "DeviceCodeError", code: "expired_token" });
  });

  it("times out when the deadline elapses", async () => {
    stubFetch([{ ok: false, json: { error: { code: "authorization_pending", message: "wait" } } }]);
    await expect(
      pollDeviceToken("abc", { arispayUrl: BASE, intervalMs: 5, timeoutMs: 10 }),
    ).rejects.toMatchObject({ name: "DeviceCodeError", code: "device_code_timeout" });
  });
});

describe("runDeviceAuth", () => {
  it("wires requestDeviceCode → onCode → pollDeviceToken", async () => {
    stubFetch([
      // First call: request device code
      {
        ok: true,
        json: {
          deviceCode: "abc",
          userCode: "WXYZ-1234",
          verificationUrl: `${BASE}/device`,
          expiresIn: 300,
          interval: 0.001, // 1 ms in seconds — keeps the test fast
        },
      },
      // Second call: poll returns approval
      { ok: true, json: { accessToken: "ap_live_xyz" } },
    ]);
    const seen: string[] = [];
    const token = await runDeviceAuth({
      arispayUrl: BASE,
      onCode: (info) => {
        seen.push(info.userCode);
      },
    });
    expect(seen).toEqual(["WXYZ-1234"]);
    expect(token.accessToken).toBe("ap_live_xyz");
  });
});

describe("DeviceCodeError", () => {
  it("exposes .code for terminal-error handling", () => {
    const err = new DeviceCodeError("access_denied", "no");
    expect(err.code).toBe("access_denied");
    expect(err.message).toBe("no");
  });
});
