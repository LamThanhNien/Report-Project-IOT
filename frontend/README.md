# IoT Device Management Frontend

React 18, Vite, TypeScript, TanStack Query, TailwindCSS and Recharts.

Run from this directory:

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

The root route redirects to login. Authentication uses the backend session flow. Tenant workspaces keep device registration, online/offline presence, telemetry, alerts, device groups, commands, Automation and firmware/OTA.

Projects provide a fixed workspace for operational scope; custom pages, widgets and dashboard editing have been removed. AI/TinyML, advanced analytics and reports, the marketing website, custom API documentation portal, billing and commercial plan editors are removed.

Administrators retain tenant ownership, account management, quota-plan mapping, device registry, audit and basic infrastructure readiness. Supported roles are Admin, Tenant Owner, and Viewer. Owners retain canvas, Automation, Command, and OTA management; viewers have read-only access. Unsupported account roles cannot sign in or enter authenticated routes.

Development requests use the Vite API proxy. Production uses `VITE_API_BASE_URL`; configure it to the backend URL. Backend Swagger remains available through the native `/docs` endpoint.
