import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast, ToastViewport } from "./Toast";
import { ToastProvider } from "../../contexts/ToastContext";
import { notificationApi, notifications } from "../../lib/notifications";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: unknown) => typeof options === "object" && options !== null && "defaultValue" in options ? options.defaultValue : key }),
}));

afterEach(() => { cleanup(); notificationApi.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("workspace notifications", () => {
  it("announces errors assertively and allows explicit dismissal of persistent notifications", () => {
    const dismiss = vi.fn();
    const { container } = render(<Toast open tone="error" message="Widget could not be saved" duration={0} dismissLabel="Dismiss error" onClose={dismiss} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Widget could not be saved");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(container).not.toContainElement(alert);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("automatically dismisses a success message at its configured duration", () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    render(<Toast open message="Layout saved" tone="success" duration={1000} onClose={dismiss} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    act(() => vi.advanceTimersByTime(999));
    expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("deduplicates repeated feedback and removes it through the mounted provider", () => {
    render(<ToastProvider><span>Workspace</span></ToastProvider>);
    let first!: string;
    let duplicate!: string;
    act(() => {
      first = notificationApi.success("Layout saved", { duration: 0 });
      duplicate = notificationApi.success("Layout saved", { duration: 0 });
    });
    expect(duplicate).toBe(first);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notifications.getSnapshot()).toHaveLength(0);
  });

  it("measures the app header for toast placement and cleans up when the viewport closes", () => {
    const header = document.createElement("header");
    header.setAttribute("data-app-topbar", "");
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ height: 88 } as DOMRect);
    document.body.appendChild(header);
    const { unmount } = render(<ToastViewport><span>Saved</span></ToastViewport>);
    expect(document.documentElement.style.getPropertyValue("--app-toast-safe-header-height")).toBe("88px");
    expect(screen.getByTestId("toast-viewport")).toHaveAttribute("data-toast-placement", "below-topbar");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--app-toast-safe-header-height")).toBe("");
    header.remove();
  });
});
