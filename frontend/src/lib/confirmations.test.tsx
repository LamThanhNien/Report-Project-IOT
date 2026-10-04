import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../contexts/ConfirmContext";
import { confirmations, requestConfirmation } from "./confirmations";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === "string" ? fallback : key }),
}));

afterEach(() => { cleanup(); confirmations.resolve(false); });

describe("confirmation authorization", () => {
  it("cannot approve a destructive action when no confirmation provider is mounted", async () => {
    await expect(requestConfirmation({ title: "Delete widget", destructive: true })).resolves.toBe(false);
    expect(confirmations.getSnapshot()).toBeNull();
  });

  it("rejects the previous pending action when another confirmation replaces it", async () => {
    const unsubscribe = confirmations.subscribe(vi.fn());
    try {
      const first = requestConfirmation({ title: "Delete first widget" });
      const second = requestConfirmation({ title: "Delete second widget" });
      await expect(first).resolves.toBe(false);
      expect(confirmations.getSnapshot()?.title).toBe("Delete second widget");
      confirmations.resolve(true);
      await expect(second).resolves.toBe(true);
      expect(confirmations.getSnapshot()).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it("only approves after the displayed exact confirmation is entered and clicked", async () => {
    render(<ConfirmProvider><span>Workspace</span></ConfirmProvider>);
    let accepted!: Promise<boolean>;
    act(() => { accepted = requestConfirmation({ title: "Delete widget", confirmationText: "sensor-1", confirmationLabel: "Widget identifier" }); });
    expect(screen.getByRole("alertdialog", { name: "Delete widget" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Widget identifier" }), { target: { value: "sensor-1" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await expect(accepted).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("rejects a cancelled action without approving it", async () => {
    render(<ConfirmProvider><span>Workspace</span></ConfirmProvider>);
    let accepted!: Promise<boolean>;
    act(() => { accepted = requestConfirmation({ title: "Delete widget" }); });
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await expect(accepted).resolves.toBe(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("rejects pending authorization if its confirmation surface unmounts", async () => {
    const { unmount } = render(<ConfirmProvider><span>Workspace</span></ConfirmProvider>);
    let accepted!: Promise<boolean>;
    act(() => { accepted = requestConfirmation({ title: "Delete widget" }); });
    const settled = vi.fn();
    void accepted.then(settled);
    unmount();
    await Promise.resolve();
    expect(settled).toHaveBeenCalledWith(false);
    expect(confirmations.getSnapshot()).toBeNull();
  });
});
