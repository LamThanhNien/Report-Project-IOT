import type { TenantProjectSummary } from "../../../types";

/** Generate 1–2 uppercase initials from a project name */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return "PR";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** 8 balanced, high-contrast Tailwind CSS gradients for project avatars */
export const LOGO_GRADIENTS = [
  "from-sky-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-teal-600",
  "from-indigo-500 to-violet-600",
  "from-teal-500 to-emerald-600",
];

/** Get deterministic gradient class based on project ID */
export function getLogoGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return LOGO_GRADIENTS[hash % LOGO_GRADIENTS.length];
}

export interface ProjectStatusInfo {
  label: string;
  textColor: string;
  dotColor: string;
  badgeBg: string;
  isActive: boolean;
}

export interface ProjectOverview extends TenantProjectSummary {
  device_count?: number;
  online_count?: number;
}

export function getProjectStatus(
  project: ProjectOverview,
  t: (key: string, fallback: string) => string,
): ProjectStatusInfo {
  if ((project.online_count ?? 0) > 0) {
    return {
      label: t("projects:status.active", "Đang hoạt động"),
      textColor: "text-emerald-700 dark:text-emerald-400 font-medium",
      dotColor: "bg-emerald-500",
      badgeBg: "bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/30 dark:border-emerald-800/40",
      isActive: true,
    };
  }
  return {
    label: project.device_count === undefined ? t("projects:status.unavailable", "Chưa có dữ liệu trạng thái") : project.device_count > 0 ? t("projects:status.offline", "Offline") : t("projects:status.draft", "Chưa có thiết bị"),
    textColor: "text-slate-600 dark:text-text-muted font-medium",
    dotColor: "bg-slate-400 dark:bg-slate-500",
    badgeBg: "bg-slate-100 border-slate-200/80 dark:bg-surface-elevated dark:border-border-subtle",
    isActive: false,
  };
}
