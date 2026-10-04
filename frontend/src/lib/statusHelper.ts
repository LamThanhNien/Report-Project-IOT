import type { StatusTone } from "./status";

/**
 * Convert a status string to a StatusTone for use with StatusBadge.
 */
export function statusToTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (["online", "active", "success", "completed", "acked", "claimed", "applied"].includes(s)) return "success";
  if (["offline", "failed", "error", "revoked", "timeout", "unsupported", "not_applied"].includes(s)) return "danger";
  if (["pending", "sent", "started", "accepted", "downloading", "provisioning", "archived", "dispatching", "dispatched", "received", "verifying"].includes(s)) return "info";
  if (["warning", "maintenance", "expired", "flashing", "applying", "rebooting", "partial"].includes(s)) return "warning";
  return "neutral";
}

/**
 * Format a status string to Vietnamese label.
 */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Không xác định";
  const s = status.toLowerCase();
  const map: Record<string, string> = {
    online: "Trực tuyến",
    offline: "Ngoại tuyến",
    active: "Hoạt động",
    archived: "Đã lưu trữ",
    pending: "Đang chờ",
    sent: "Đã gửi",
    started: "Đã bắt đầu",
    accepted: "Đã chấp nhận",
    downloading: "Đang tải",
    applying: "Đang áp dụng",
    rebooting: "Đang khởi động lại",
    dispatching: "Đang gửi",
    dispatched: "Đã gửi",
    received: "Đã nhận",
    verifying: "Đang xác minh",
    verified: "Đã xác minh",
    applied: "Đã áp dụng",
    unsupported: "Chưa hỗ trợ",
    not_applied: "Chưa áp dụng",
    success: "Thành công",
    error: "Lỗi",
    warning: "Cảnh báo",
    critical: "Nghiêm trọng",
    info: "Thông tin",
    open: "Đang mở",
    acknowledged: "Đã ghi nhận",
    resolved: "Đã xử lý",
    production: "Sản xuất",
    staging: "Kiểm thử",
    draft: "Bản nháp",
    server: "Máy chủ",
    tenant: "Tenant",
    device_group: "Nhóm thiết bị",
    anomaly: "Bất thường",
    normal: "Bình thường",
    acked: "Đã xác nhận",
    completed: "Hoàn thành",
    failed: "Thất bại",
    timeout: "Hết thời gian",
    claimed: "Đã claim",
    expired: "Hết hạn",
    revoked: "Đã thu hồi",
    manual: "Thủ công",
    dynamic: "Tự động",
    tag_based: "Theo tag",
    device: "Thiết bị",
    group: "Nhóm",
  };
  return map[s] || status;
}
