# MinIO

MinIO is included in Phase 1 as S3-compatible object storage for future firmware binaries.

Current scope:

- Run MinIO locally on `localhost:9000`.
- Run the MinIO console on `localhost:9001`.
- Provide credentials through `.env`.
- Keep `MINIO_SECURE=false` for the local development stack.

Production TLS:

- Use `MINIO_SECURE=true`.
- Mount certificates under `infrastructure/minio/certs`.
- Use `infrastructure/docker-compose.prod.yml`, which starts MinIO with
  `--certs-dir /certs` and checks health over HTTPS.
