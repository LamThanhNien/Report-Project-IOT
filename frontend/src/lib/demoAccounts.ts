export function getDemoCredentials(env: Record<string, unknown>, development: boolean) {
  if (!development) return [];
  const configured = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0 && !/^(REPLACE_|Configure )/.test(value);
  return ([
    ["ADMIN", "Admin", "sky"],
    ["TENANT", "Tenant Owner", "emerald"],
    ["VIEWER", "Viewer", "emerald"],
  ] as const).flatMap(([key, role, color]) => {
    const email = env[`VITE_DEMO_${key}_EMAIL`];
    const passwordValue = env[`VITE_DEMO_${key}_PASSWORD`];
    const hint = env[`VITE_DEMO_${key}_PASSWORD_HINT`];
    if (!configured(email) || !configured(passwordValue)) return [];
    return [{ role, color, email, passwordValue, passwordLabel: configured(hint) ? hint : passwordValue }];
  });
}
