# x402 Protocol Reference

This document describes the x402 payment protocol as implemented by payagent.

## Overview

x402 uses HTTP status code 402 (Payment Required) for machine-to-machine API payments using USDC stablecoins. Agents sign EIP-3009 `transferWithAuthorization` messages — gasless off-chain signatures that authorize USDC transfers without requiring gas tokens.

## Wire Format

### 402 Response (Server → Agent)

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "maxAmountRequired": "100000",
      "resource": "https://api.example.com/data",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xMerchantWallet",
      "extra": { "name": "USDC", "version": "2" }
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `x402Version` | `2` | Protocol version |
| `accepts` | `X402Accept[]` | Payment options the server accepts |
| `scheme` | `"exact"` | Payment scheme (exact amount) |
| `network` | `string` | CAIP-2 chain identifier (e.g. `eip155:8453` for Base) |
| `maxAmountRequired` | `string` | USDC amount in base units (6 decimals). `100000` = $0.10 |
| `resource` | `string` | URL of the resource being purchased |
| `asset` | `string` | USDC contract address on the specified chain |
| `payTo` | `string` | Recipient wallet address |
| `extra.name` | `"USDC"` | Token name for EIP-712 domain |
| `extra.version` | `"2"` | Token version for EIP-712 domain |

### X-PAYMENT Header (Agent → Server)

Base64-encoded JSON:

```json
{
  "x402Version": 2,
  "payload": {
    "signature": "0xabcd...1234",
    "authorization": {
      "from": "0xAgentWallet",
      "to": "0xMerchantWallet",
      "value": "100000",
      "validAfter": "1748764800",
      "validBefore": "1748765280",
      "nonce": "0x7a8b9c..."
    }
  },
  "accepted": { "...same as the accept option that was signed..." },
  "resource": "https://api.example.com/data"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `signature` | `string` | EIP-712 signature (65 bytes, hex) |
| `authorization.from` | `string` | Payer wallet address |
| `authorization.to` | `string` | Recipient wallet address |
| `authorization.value` | `string` | USDC amount in base units |
| `authorization.validAfter` | `string` | Unix timestamp — signature not valid before |
| `authorization.validBefore` | `string` | Unix timestamp — signature not valid after |
| `authorization.nonce` | `string` | Random bytes32 for replay protection |

## EIP-712 Domain

```
name: "USD Coin"
version: "2"
chainId: <from network field>
verifyingContract: <asset field>
```

## EIP-712 Types

```
TransferWithAuthorization(
  address from,
  address to,
  uint256 value,
  uint256 validAfter,
  uint256 validBefore,
  bytes32 nonce
)
```

## Supported Chains

| Chain | Network ID | USDC Contract |
|-------|-----------|---------------|
| Base | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Ethereum | `eip155:1` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Polygon | `eip155:137` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |

## References

- [x402 protocol (Coinbase)](https://github.com/coinbase/x402)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)
- [EIP-712: Typed Structured Data Hashing](https://eips.ethereum.org/EIPS/eip-712)
- [CAIP-2: Blockchain ID Specification](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md)
