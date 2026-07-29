# buyforme

A tiny CLI alias for [`payagent`](https://www.npmjs.com/package/payagent).

```bash
npx buyforme https://api.example.com/premium
```

…is exactly equivalent to:

```bash
npx payagent pay https://api.example.com/premium
```

Use whichever feels more natural at the shell. `buyforme` is intentionally a one-trick verb — point it at a URL and it pays. Everything else (auth, agent creation, funding, limits, networks) is handled by the underlying `payagent` SDK + CLI.

## Install

```bash
npm install -g buyforme
# or one-shot:
npx buyforme https://api.example.com/premium
```

Requires Node.js >= 18.

## Behaviour

- If the **first argument starts with `http://` or `https://`**, `buyforme` invokes `payagent pay <url> ...rest`. All other `payagent pay` flags work — pass them straight through (`--agent`, `--per-tx`, `--daily`, `--monthly`, `--network`, `--domains`, `--method`, `--body`, `--amount`).
- If the **first argument is anything else** (`init`, `agent`, `balance`, `--help`, …), `buyforme` forwards args verbatim to `payagent`. So `buyforme init`, `buyforme agent create --name hermes`, `buyforme --help` all work.

## What it's a proxy for

`payagent` provisions a delegated-custody agent wallet through [ArisPay](https://arispay.app): Coinbase CDP holds the signing key, ArisPay enforces per-transaction, daily, monthly, and allowed-domain limits server-side, and signs on your agent's behalf when it hits an HTTP 402. No private keys ever live in your process.

For full docs, see the [`payagent` README](https://www.npmjs.com/package/payagent).

## License

MIT © Polar Industries Ltd
