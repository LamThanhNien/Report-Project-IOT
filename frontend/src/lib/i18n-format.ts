import i18n from "./i18n";

export function getActiveLocale(): string {
  const lang = i18n.language || "vi";
  return lang.startsWith("en") ? "en-US" : "vi-VN";
}

/**
 * Format a number based on current active locale.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const locale = getActiveLocale();
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format date/time based on current active locale.
 */
export function formatDate(date: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  const locale = getActiveLocale();
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "--";
  
  const defaultOptions: Intl.DateTimeFormatOptions = options || {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  
  return new Intl.DateTimeFormat(locale, defaultOptions).format(d);
}

/**
 * Format percentage (e.g. 98.5%). Unit '%' is technical, only number format changes.
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${formatNumber(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

/**
 * Format milliseconds (e.g. 150 ms). Unit 'ms' is technical, only number format changes.
 */
export function formatMs(value: number): string {
  return `${formatNumber(value)} ms`;
}

/**
 * Format RSSI signal strength (e.g. -65 dBm). Unit 'dBm' is technical.
 */
export function formatRssi(value: number): string {
  return `${formatNumber(value)} dBm`;
}

/**
 * Format byte sizes (e.g. 1.2 MB). Units (B, KB, MB, GB) are technical standard.
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const num = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${formatNumber(num)} ${sizes[i]}`;
}
