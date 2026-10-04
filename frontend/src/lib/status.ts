/**
 * Centralized status mappings — keep consistent across the app.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export const DEVICE_STATUS_TONE: Record<string, StatusTone> = {
  online: "success",
  offline: "danger",
  maintenance: "warning",
  unknown: "neutral",
  provisioning: "info",
  deleted: "neutral",
};

export const OTA_STATUS_TONE: Record<string, StatusTone> = {
  pending: "neutral",
  sent: "info",
  started: "info",
  accepted: "info",
  downloading: "info",
  flashing: "warning",
  applying: "warning",
  rebooting: "warning",
  verifying: "info",
  success: "success",
  completed: "success",
  failed: "danger",
  rolled_back: "warning",
  cancelled: "neutral",
};

export const SEVERITY_TONE: Record<string, StatusTone> = {
  info: "info",
  low: "info",
  warning: "warning",
  medium: "warning",
  critical: "danger",
  high: "danger",
};

export function deviceTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return DEVICE_STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

export function otaTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return OTA_STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

export function severityTone(severity: string | null | undefined): StatusTone {
  if (!severity) return "neutral";
  return SEVERITY_TONE[severity.toLowerCase()] ?? "neutral";
}

export const TONE_CLASSES: Record<StatusTone, { chip: string; dot: string; text: string; bg: string }> = {
  success: {
    chip: "tone-success-chip",
    dot: "tone-success-dot",
    text: "tone-success-text",
    bg: "tone-success-bg",
  },
  warning: {
    chip: "tone-warning-chip",
    dot: "tone-warning-dot",
    text: "tone-warning-text",
    bg: "tone-warning-bg",
  },
  danger: {
    chip: "tone-danger-chip",
    dot: "tone-danger-dot",
    text: "tone-danger-text",
    bg: "tone-danger-bg",
  },
  info: {
    chip: "tone-info-chip",
    dot: "tone-info-dot",
    text: "tone-info-text",
    bg: "tone-info-bg",
  },
  neutral: {
    chip: "tone-neutral-chip",
    dot: "tone-neutral-dot",
    text: "tone-neutral-text",
    bg: "tone-neutral-bg",
  },
};
