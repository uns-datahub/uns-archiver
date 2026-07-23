# Security policy

Please do not report security vulnerabilities in a public issue.

Use GitHub's private vulnerability reporting for this repository. Include affected
versions, reproduction steps, impact, and any suggested mitigation.

Never commit controller credentials, MQTT credentials, QuestDB credentials,
deployment configurations, generated live topic metadata, or buffered event data.
The control API must be configured with JWKS or an explicit
`UNS_API_JWT_SECRET`; there is no built-in default secret.
