# Access Control

The supported roles are `admin`, `tenant_owner`, and `viewer`.

- Admin manages platform-owned resources, tenant configuration and platform health. Tenant-owned operational data remains read-only through admin support views.
- Tenant Owner manages only the authenticated tenant’s devices, project canvas/widgets, Datastreams, Commands, Automation, firmware and OTA.
- Viewer reads tenant data. It cannot mutate project data, send commands, run OTA or manage members. Stored legacy permissions cannot grant a Viewer write access.

Backend authentication rejects unsupported roles during login, refresh and authenticated requests. Existing unsupported user records are preserved without role promotion or data deletion. New member roles are validated server-side.

Tenant-scoped services resolve the tenant from the authenticated user rather than request bodies. Cross-tenant device/project/widget access returns not-found responses. Feature flags and frontend route guards do not replace backend checks.

Owner portal member management creates Viewer accounts; platform Admin does not mutate tenant-owned user resources. Profile changes do not provide a role escalation path.

Tenant project canvas data uses `/api/v1/client/projects/...`; admin tenant project support views use `/api/v1/admin/tenants/{tenant_id}/projects/...` and remain read-only.

JWT validation, refresh rotation, CSRF, disabled account/tenant checks, audit events and resource ownership checks remain enabled. Commands, OTA and Automation retain their existing MQTT contracts.
