# Audit Coverage Matrix — Aifom Backend

Generated: 2026-06-19. Phase 0 implementation.

This matrix covers all sensitive mutations across the platform. Each row
specifies the audit requirements for a given mutation.

**Legend:**
- **Endpoint/Service**: FastAPI route or background service
- **Actor**: Who performs the action (admin, tenant_owner, viewer)
- **Tenant Scope**: Whether tenant_id is recorded
- **Action Name**: The `action` field in AuditLog
- **Resource Type**: The `resource_type` field
- **Success Audit**: Required (✓) or Optional (○)
- **Failure Audit**: Required (✓) or Optional (○) or N/A
- **Before/After**: Whether changed field snapshot is captured
- **Sensitive Field Policy**: How sensitive data is handled in `detail`

---

## 1. Identity and Authentication

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /auth/login` | anonymous | no | `user.login` | user | ✓ | ✓ | no | Never log password; log username and IP only |
| `POST /auth/logout` | user | optional | `user.logout` | user | ✓ | ○ | no | Token ID only (not token value) |
| `POST /auth/register` | anonymous | optional | `user.register` | user | ✓ | ✓ | no | Never log password; log email/username |
| `POST /auth/refresh` | user | optional | `token.refresh` | token | ○ | ✓ | no | Never log token values |
| `POST /auth/change-password` | user | optional | `user.password_change` | user | ✓ | ✓ | no | Never log old/new password |
| Token blacklist cleanup | system | no | `token.cleanup` | token | ✓ | ✓ | no | Count only, no token values |

---

## 2. Users, Roles, and Permissions

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /users` (create) | admin/PE | yes | `user.create` | user | ✓ | ✓ | no | Never log password; log email/role |
| `PATCH /users/{id}` | admin/PE | yes | `user.update` | user | ✓ | ○ | after | `changed_fields` only; never log new password |
| `DELETE /users/{id}` | admin/PE | yes | `user.delete` | user | ✓ | ○ | before | Snapshot username/email (no password) |
| `POST /users/{id}/roles` | admin/PE | yes | `user.role_assign` | user | ✓ | ○ | after | Role name only |
| `DELETE /users/{id}/roles` | admin/PE | yes | `user.role_revoke` | user | ✓ | ○ | before | Role name only |
| `PATCH /users/{id}/permissions` | admin/PE | yes | `user.permission_update` | user | ✓ | ○ | after | Permission set diff |

---

## 3. Tenants

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /tenants` | admin | no | `tenant.create` | tenant | ✓ | ✓ | no | Log name/plan; never log credentials |
| `PATCH /tenants/{id}` | admin | yes | `tenant.update` | tenant | ✓ | ○ | after | `changed_fields` list; no secrets |
| `DELETE /tenants/{id}` | admin | yes | `tenant.delete` | tenant | ✓ | ✓ | before | Name/ID snapshot |
| `POST /tenants/{id}/plan` | admin | yes | `tenant.plan_change` | tenant | ✓ | ○ | after | Old/new plan name |

---

## 4. Device Assignment and Provisioning

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /devices/register` | device | yes | `device.register` | device | ✓ | ✓ | no | Never log provisioning secret |
| `POST /devices/{id}/assign` | admin | yes | `device.assign` | device | ✓ | ✓ | after | Tenant ID and device UID only |
| `DELETE /devices/{id}/assign` | admin | yes | `device.unassign` | device | ✓ | ✓ | before | Tenant ID and device UID |
| `POST /provisioning/tokens` | admin | yes | `provisioning.token_create` | token | ✓ | ○ | no | Never log token value |
| `POST /provisioning/claim` | device | yes | `device.provisioning_claim` | device | ✓ | ✓ | no | Device UID only; never log secret |

---

## 5. Device Credentials

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /devices/{id}/credentials` | admin | yes | `device.credential_rotate` | device | ✓ | ✓ | no | Never log credential values |
| `DELETE /devices/{id}/credentials` | admin | yes | `device.credential_revoke` | device | ✓ | ✓ | no | Credential ID only |

---

## 6. Remote Commands

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /commands` | tenant_user | yes | `command.send` | command | ✓ | ✓ | no | Command type only; no payload values that are secrets |
| Command result intake | system | yes | `command.result` | command | ○ | ✓ | no | Status code only |

---

## 7. Rules and Automation

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /rules` | tenant_user | yes | `rule.create` | rule | ✓ | ✓ | no | Rule name/type; no webhook secrets |
| `PATCH /rules/{id}` | tenant_user | yes | `rule.update` | rule | ✓ | ○ | after | `changed_fields`; never log webhook URLs with auth |
| `DELETE /rules/{id}` | tenant_user | yes | `rule.delete` | rule | ✓ | ○ | before | Rule name/ID |
| `POST /rules/{id}/enable` | tenant_user | yes | `rule.enable` | rule | ✓ | ○ | no | Rule ID |
| `POST /rules/{id}/disable` | tenant_user | yes | `rule.disable` | rule | ✓ | ○ | no | Rule ID |

---

## 8. Firmware

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /firmware` | admin | yes | `firmware.upload` | firmware | ✓ | ✓ | no | Filename/size/checksum; never log MinIO credentials |
| `DELETE /firmware/{id}` | admin | yes | `firmware.delete` | firmware | ✓ | ✓ | before | Filename/ID |
| `POST /firmware/{id}/sign` | admin | yes | `firmware.sign` | firmware | ✓ | ✓ | no | Firmware ID and key_id only; never log private key |
| `GET /firmware/{id}/download` | device | yes | `firmware.download` | firmware | ○ | ○ | no | Device UID; never log signed URL |

---

## 9. OTA Jobs and Campaigns

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /ota/jobs` | admin/tenant_user | yes | `ota.job_create` | ota_job | ✓ | ✓ | no | Target device, firmware ID |
| `POST /ota/campaigns` | admin | yes | `ota.campaign_create` | ota_campaign | ✓ | ✓ | no | Target group, firmware ID |
| `PATCH /ota/jobs/{id}` | system | yes | `ota.job_status_update` | ota_job | ✓ | ✓ | after | Status only; no download URLs |
| `DELETE /ota/campaigns/{id}` | admin | yes | `ota.campaign_cancel` | ota_campaign | ✓ | ○ | before | Campaign ID |

---

## 10. TinyML Models ✅ Fixed in Phase 0

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /tinyml/models` | admin | yes | `create_model` | model | ✓ | ○ | no | Name/description only; never log file paths |
| `POST /tinyml/model-versions/{id}/activate` | **admin** ✓ | yes | `activate_model_version` | model_version | ✓ | ○ | no | Model ID; never log file path |
| `POST /tinyml/model-versions/{id}/rollback` | **admin** ✓ | yes | `rollback_model_version` | model_version | ✓ | ○ | no | Model ID; never log file path |
| `POST /tinyml/training-jobs` | admin | yes | `create_training_job` | training_job | ✓ | ○ | no | Model ID; no training data paths |
| `POST /tinyml/deployments` | admin | yes | `create_deployment` | deployment | ✓ | ○ | no | Device ID, model version ID |
| `POST /tinyml/inference/run` | tenant_user | yes | `run_inference` | inference | ✓ | ✓ | no | Model ID, result count; no feature values |

> ✅ **Phase 0 fix**: `activate_model_version` and `rollback_model_version` now
> record `user_id` (administrator) via `require_admin` dependency.

---

## 11. Model Versions

See TinyML Models above.

---

## 12. Training Jobs

See TinyML Models above. `create_training_job` records `user_id` and `resource_id`.

---

## 13. Deployments

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /tinyml/deployments` | admin | yes | `create_deployment` | deployment | ✓ | ○ | no | Device ID, model version ID |
| `GET /tinyml/deployments/{id}/status` | device | yes | `deployment.status_update` | deployment | ○ | ○ | after | Status only |

---

## 14. Platform Settings

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `PATCH /settings` | admin/PE | no | `settings.update` | settings | ✓ | ○ | after | `changed_fields` list; never log credential values |

---

## 15. Administrative Exports and Destructive Operations

| Endpoint | Actor | Tenant | Action | Resource | Success | Failure | Before/After | Sensitive Field Policy |
|----------|-------|--------|--------|----------|---------|---------|--------------|----------------------|
| `POST /admin/export` | admin | optional | `admin.export` | export | ✓ | ✓ | no | Export type; never log export contents |
| `DELETE /admin/purge` | admin | yes | `admin.purge` | resource | ✓ | ✓ | before | Resource type and count |
| `POST /admin/bulk-assign` | admin | yes | `admin.bulk_assign` | device | ✓ | ✓ | no | Count; tenant ID |

---

## Phase 0 Coverage Status

### Fixed in Phase 0
- `activate_model_version`: now records `user_id` and `outcome`
- `rollback_model_version`: now records `user_id` and `outcome`
- Audit payload sanitizer now bounded (depth, keys, list, string, total size)
- Sensitive key matching case-insensitive with explicit allowlist
- Audit transaction modes explicit (atomic vs best-effort)

### Additional Phase 0 coverage completed
- Internal callers use an explicit best-effort audit API; the ambiguous alias is
  retained only for external compatibility.
- Login success/failure, registration, logout, refresh, profile update, and
  password change are audited.
- OTA campaign lifecycle and firmware signing are audited.
- Device claim-code creation, claim, and revoke are audited without claim-code values.
- Rule create/update/delete/enable/disable/duplicate and field-definition creation
  are audited.

### Not applicable to current routes
- `POST /admin/export` and `DELETE /admin/purge` are reserved coverage rules;
  no such mutation endpoints currently exist. If added, audit is mandatory.

### Phase 1 enrichment
- Add richer allowlisted `before` snapshots where `changed_fields` already
  provides the Phase 0 mutation record. This must never include secrets.
