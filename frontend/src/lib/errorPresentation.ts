import type { TFunction } from "i18next";
import { ApiError } from "../services/apiClient";

/** Present actionable errors without exposing response bodies or internal traces. */
export function userSafeErrorMessage(error: unknown, t?: TFunction): string {
  const status = error instanceof ApiError ? error.status : undefined;
  const copy = status === 401
    ? ["errors.authentication", "Your session has expired. Please sign in again."]
    : status === 403
      ? ["errors.authorization", "You do not have permission to perform this action."]
      : status === 404
        ? ["errors.not_found", "The requested resource was not found or is not accessible."]
        : status === 409
          ? ["errors.conflict", "This change conflicts with the current data. Refresh and try again."]
          : status === 422
            ? ["errors.validation", "Please check the information you entered."]
            : status === 429
              ? ["errors.rate_limit", "Too many requests. Please wait and try again."]
              : ["errors.request_failed", "Unable to complete the request. Please try again."];
  return t ? String(t(copy[0], { defaultValue: copy[1] })) : copy[1];
}
