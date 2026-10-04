# Frontend Architecture

The application exposes Admin and Client surfaces. Supported roles are `admin`, `tenant_owner` and `viewer`. Unsupported roles are rejected by authentication and route guards rather than redirected into a permitted console.

Client pages use tenant-scoped `clientApi` services. Admin pages use admin-scoped services and display tenant-owned operational resources read-only. Shared layout and UI components do not bypass these API boundaries.

`/client/dashboard` displays the tenant overview. `/client/workspace/:projectId/home` mounts `ProjectEditor` to load persisted pages/widgets, the canvas and actual scoped device runtime state. Project managers configure and save widgets; Viewers see the saved canvas read-only. Command controls require command permission separately from canvas editing.

Devices, Datastreams, Commands, Automation, firmware, OTA, tenant member management and audit views remain. AI/TinyML, templates, commercial UI, advanced reports and public marketing are absent. Demo login shows three accounts: Admin, Tenant Owner and Viewer; production builds do not expose demo credentials.

Read, write and tenant ownership checks are enforced by the backend. Frontend feature flags only control presentation. Mobile navigation, dialog focus, reduced motion and translation keys use shared components.
