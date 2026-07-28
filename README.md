# UNS Archiver

UNS Archiver is a [UNS OpenHub](https://github.com/uns-datahub) add-on that persists
UNS data and table packets to QuestDB. It discovers active topics through the
controller, subscribes to configured MQTT topic filters, and publishes the resulting
QuestDB table mappings back to the UNS infrastructure.

## Features

- Archives scalar data and table packets to QuestDB.
- Supports `append`, `dedup`, and soft-delete `window_replace` ingestion modes.
- Derives stable QuestDB identities from UNS topic metadata.
- Buffers early or transiently failed events on disk and retries them.
- Publishes QuestDB mapping and dependency-health metadata.
- Exposes authenticated control endpoints for status, pause, resume, and topics.

## Requirements

- Node.js 22 or newer
- pnpm 10
- A running UNS OpenHub controller and MQTT broker
- QuestDB with HTTP line protocol enabled

## Setup

```bash
pnpm install
cp config-example.json config.json
export UNS_PASSWORD='your-controller-password'
pnpm run dev
```

Edit `config.json` for your UNS endpoints, MQTT hosts, QuestDB connection, and topic
filters. The controller credentials are used to discover the active topic registry;
the password example is resolved from `UNS_PASSWORD` and is not stored in the file.

The control API must use either `uns.jwksWellKnownUrl` or `UNS_API_JWT_SECRET`.
JWKS is preferred when the archiver runs alongside UNS OpenHub.

## Configuration

The complete configuration contract is documented in
[`config.schema.json`](./config.schema.json). A storage rule maps a topic filter to a
QuestDB table prefix:

```json
{
  "tablePrefix": "uns_enterprise",
  "topic": "enterprise/#",
  "ingestMode": "dedup"
}
```

`config.json`, `.env`, the event queue, and active-topic cache are intentionally
ignored by Git.

## Development

```bash
pnpm run verify
```

This runs the unit tests, TypeScript typecheck, and clean production build.

Additional scripts:

```bash
pnpm run generate-config-schema
pnpm run generate-codegen
pnpm run refresh-uns
```

The generated `UnsTopics` and `UnsTags` types are intentionally generic in this
repository. Run `refresh-uns` only against an environment whose topic and tag
metadata you are comfortable writing into your working tree.

## Releases

The package version is the source of truth. A release tag must be exactly
`v<package.json version>`; the release workflow validates the tag and runs the full
verification suite. This repository does not publish a package automatically.

## Security

Do not commit deployment configurations, credentials, generated environment
metadata, or buffered events. See [SECURITY.md](./SECURITY.md) for reporting
vulnerabilities.

## License

[MIT](./LICENSE) © Aljoša Vister.
