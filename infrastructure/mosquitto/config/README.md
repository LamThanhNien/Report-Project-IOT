# Config

Mosquitto broker configuration files.

- `mosquitto.conf` is for local development on plaintext port 1883.
- `mosquitto.prod.conf` is for production-style TLS on port 8883.
- `acl.prod` rejects shared demo device credentials and requires one username
  per device. Set `MQTT_PASSWORD_FILE` to an externally provisioned Mosquitto
  password file containing `aifom_backend` and each production device. Never
  commit that password file.

For production, place broker certificates under `infrastructure/mosquitto/certs`:

- `ca.crt`
- `server.crt`
- `server.key`
