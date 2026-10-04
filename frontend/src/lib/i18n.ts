import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import viCommon from "../locales/vi/common.json";
import enCommon from "../locales/en/common.json";
import viNav from "../locales/vi/nav.json";
import enNav from "../locales/en/nav.json";
import viAudit from "../locales/vi/audit.json";
import enAudit from "../locales/en/audit.json";
import viDashboard from "../locales/vi/dashboard.json";
import enDashboard from "../locales/en/dashboard.json";
import viProjects from "../locales/vi/projects.json";
import enProjects from "../locales/en/projects.json";
import viDevices from "../locales/vi/devices.json";
import enDevices from "../locales/en/devices.json";
import viMonitoring from "../locales/vi/monitoring.json";
import enMonitoring from "../locales/en/monitoring.json";
import viAlerts from "../locales/vi/alerts.json";
import enAlerts from "../locales/en/alerts.json";
import viAccount from "../locales/vi/account.json";
import enAccount from "../locales/en/account.json";
import viAutomation from "../locales/vi/automation.json";
import enAutomation from "../locales/en/automation.json";
import viOta from "../locales/vi/ota.json";
import enOta from "../locales/en/ota.json";
import viUsers from "../locales/vi/users.json";
import enUsers from "../locales/en/users.json";
import viAuth from "../locales/vi/auth.json";
import enAuth from "../locales/en/auth.json";

export const defaultNS = "common";

export const resources = {
  vi: {
    common: viCommon,
    nav: viNav,
    audit: viAudit,
    dashboard: viDashboard,
    projects: viProjects,
    devices: viDevices,
    monitoring: viMonitoring,
    alerts: viAlerts,
    account: viAccount,
    automation: viAutomation,
    ota: viOta,
    users: viUsers,
    auth: viAuth,
  },
  en: {
    common: enCommon,
    nav: enNav,
    audit: enAudit,
    dashboard: enDashboard,
    projects: enProjects,
    devices: enDevices,
    monitoring: enMonitoring,
    alerts: enAlerts,
    account: enAccount,
    automation: enAutomation,
    ota: enOta,
    users: enUsers,
    auth: enAuth,
  },
} as const;

// Read saved language from localStorage using aifom_language convention
const savedLanguage = localStorage.getItem("aifom_language") || "vi";

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: "vi",
    defaultNS,
    ns: [
      "common",
      "nav",
      "dashboard",
      "projects",
      "devices",
      "monitoring",
      "alerts",
      "audit",
      "account",
      "automation",
      "ota",
      "users",
      "auth",
    ],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
