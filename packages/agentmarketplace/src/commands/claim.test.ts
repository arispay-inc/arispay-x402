import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdClaim } from "./claim.js";
import { getClient, loadConfig, promptYesNo } from "../lib/cli-helpers.js";

// Mock only the IO-ish helpers; keep the pure ones (parseFlags, listingWebUrl).
vi.mock("../lib/cli-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/cli-helpers.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    getClient: vi.fn(),
    promptYesNo: vi.fn(),
  };
});

const DEV_KEY = "ap_test_ephemeral";
const LISTING = {
  slug: "acme/flights",
  name: "Acme Flights",
  homepage: "https://acme.example/",
  endpoint: { transport: "http" as const, url: "https://acme.example/api" },
};

describe("cmdClaim", () => {
  const savedEnv = process.env.AGENTMARKETPLACE_URL;
  let fetchMock: ReturnType<typeof vi.fn>;
  let logs: string[];

  beforeEach(() => {
    delete process.env.AGENTMARKETPLACE_URL;
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code?: unknown) => {
      throw new Error(`process.exit(${code})`);
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(loadConfig).mockReturnValue({ developerKey: DEV_KEY });
    vi.mocked(getClient).mockReturnValue({
      get: vi.fn(async () => LISTING),
    } as unknown as ReturnType<typeof getClient>);
    vi.mocked(promptYesNo).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (savedEnv === undefined) delete process.env.AGENTMARKETPLACE_URL;
    else process.env.AGENTMARKETPLACE_URL = savedEnv;
  });

  it("refuses to run without a developer (ap_live_/ap_test_) key", async () => {
    vi.mocked(loadConfig).mockReturnValue({ apiKey: "not-a-dev-key" });
    await expect(cmdClaim(["acme/flights"])).rejects.toThrow(/process.exit\(1\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prints the sha256 claim token and the well-known URL (dry-run: no network claim)", async () => {
    await cmdClaim(["acme/flights", "--dry-run"]);
    const out = logs.join("\n");
    const expectedToken = createHash("sha256").update(DEV_KEY).digest("hex");
    expect(out).toContain(expectedToken);
    // homepage trailing slash trimmed before appending the well-known path
    expect(out).toContain("https://acme.example/.well-known/arispay-claim.txt");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the well-known claim with bearer auth and the expected body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ claim: { verified: true }, listing: { claimed: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await cmdClaim(["acme/flights"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.arispay.app/v1/marketplace/agents/acme%2Fflights/claim");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${DEV_KEY}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({ method: "well-known" });
    expect(logs.join("\n")).toMatch(/Verified/);
  });

  it("exits non-zero when the server rejects the claim", async () => {
    fetchMock.mockResolvedValue(new Response("token mismatch", { status: 403 }));
    await expect(cmdClaim(["acme/flights"])).rejects.toThrow(/process.exit\(1\)/);
  });

  it("errors when the listing has no homepage (well-known claim impossible)", async () => {
    vi.mocked(getClient).mockReturnValue({
      get: vi.fn(async () => ({ ...LISTING, homepage: undefined })),
    } as unknown as ReturnType<typeof getClient>);
    await expect(cmdClaim(["acme/flights"])).rejects.toThrow(/process.exit\(1\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
