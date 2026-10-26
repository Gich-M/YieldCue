# Security

## Reporting a vulnerability

Please report security vulnerabilities privately. Do not open a public issue.

Use GitHub's private vulnerability reporting on the repository's **Security** tab (select "Report a vulnerability"). We will acknowledge as soon as possible and keep you informed of the resolution.

## Security model

- The client makes no outbound requests except to your configured alert destinations.
- The UI uses HTTP Basic authentication with username `operator` and `YIELDCUE_AUTH_TOKEN` as the password. The ingest endpoint uses a Bearer token (`YIELDCUE_INGEST_TOKEN`) that grants event ingest only.
- The client does not terminate TLS. Bind it to `127.0.0.1` (the default) or place it behind a TLS-terminating reverse proxy.

## Known limitation

Notification credentials are stored unencrypted in the local SQLite database and its backups; restrict access to both.
