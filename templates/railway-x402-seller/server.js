/**
 * Railway x402 seller template.
 *
 * One unpaid health route and one $0.01 Base-mainnet resource. The only
 * required input is the public wallet address that receives USDC.
 */
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import express from "express";

const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.arispay.app";
const NETWORK = "eip155:8453";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);

if (!PAY_TO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(PAY_TO_ADDRESS)) {
  console.error("PAY_TO_ADDRESS is required and must be a 0x-prefixed EVM address");
  process.exit(1);
}

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactEvmScheme());
const app = express();

// Railway terminates TLS one hop away. Trust exactly that hop so the x402
// challenge advertises https://, which paygate doctor verifies.
app.set("trust proxy", 1);

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    network: NETWORK,
    facilitator: FACILITATOR_URL,
  });
});

app.use(
  paymentMiddleware(
    {
      "GET /api/paid": {
        accepts: {
          scheme: "exact",
          price: "$0.01",
          network: NETWORK,
          payTo: PAY_TO_ADDRESS,
          maxTimeoutSeconds: 60,
        },
        description: "Railway x402 seller ($0.01)",
        mimeType: "application/json",
        extensions: declareDiscoveryExtension({
          output: { example: { ok: true, data: "paid content" } },
        }),
      },
    },
    resourceServer,
  ),
);

app.get("/api/paid", (_request, response) => {
  response.json({
    ok: true,
    data: "paid content",
    servedAt: new Date().toISOString(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.info(`x402 seller listening on :${PORT}`);
  console.info(`network=${NETWORK} facilitator=${FACILITATOR_URL}`);
});
