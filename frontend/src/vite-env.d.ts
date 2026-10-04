/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEMO_ADMIN_EMAIL?: string;
  readonly VITE_DEMO_ADMIN_PASSWORD?: string;
  readonly VITE_DEMO_ADMIN_PASSWORD_HINT?: string;
  readonly VITE_DEMO_TENANT_EMAIL?: string;
  readonly VITE_DEMO_TENANT_PASSWORD?: string;
  readonly VITE_DEMO_TENANT_PASSWORD_HINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
