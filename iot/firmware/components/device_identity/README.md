# device_identity

Returns a stable `device_uid` string.

- If `CONFIG_AIFOM_DEVICE_UID` is set in Kconfig, that value is used verbatim.
- Otherwise the UID is derived once at first call from the chip's base MAC:
  `esp32-<12 hex chars>`.

API:

```c
const char *device_identity_get_uid(void);
```

The pointer is owned by this module and valid for the lifetime of the
application.
