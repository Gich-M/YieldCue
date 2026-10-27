# Contributing

Thanks for your interest in contributing. YieldCue is maintainer-led: the maintainer owns scope, releases, and product direction.

## What's welcome

- **Bug fixes** — open an issue first, then a pull request.
- **README corrections and examples** — welcome.
- **New check types** — open a discussion first, and include test cases.
- **Core architecture and UI changes** — discuss first; these are usually deferred in favor of cloud-track features.

## Ground rules

- The `@yieldcue/contracts`, `@yieldcue/domain`, and `@yieldcue/notifications` packages are synced from the private monorepo. External pull requests to these packages are reviewed but landed upstream first and synced out.
- Contributions remain under the license of the package they modify. There is no CLA and no separate relicensing grant.
- Respect the client's constraints: no outbound requests except configured alert destinations, no telemetry, and all rendered user data escaped.

## Development

```bash
npm install
npm run type-check
npm run lint
npm test
npm run check:boundary
```

To run the server, set the two tokens and start it:

```bash
export YIELDCUE_AUTH_TOKEN="$(openssl rand -hex 32)"
export YIELDCUE_INGEST_TOKEN="$(openssl rand -hex 32)"
npm run dev
```
