# Contributing

This repository is scoped for an individual graduation project. Keep changes small, reviewable, and tied to the current phase.

## Rules

- Prioritize IoT device management and OTA before TinyML/MLOps.
- Do not commit secrets, private keys, real device tokens, or production credentials.
- Add tests when implementing behavior, especially OTA state transitions and MQTT payload validation.
- Update the nearest README when adding a new folder, service, endpoint, or workflow.
- Use Conventional Commits, for example `feat(ota): add firmware upload endpoint`.

## Definition Of Done

- The changed module has a clear purpose.
- Local commands needed to verify it are documented.
- Config is driven by `.env` or documented defaults.
- No large generated artifacts are committed.

