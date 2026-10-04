import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionDropdown } from "./ActionDropdown";
import { ConfirmDialog } from "./ConfirmDialog";
import { DataTable, type Column } from "./DataTable";
import { Modal } from "./Modal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === "string" ? fallback : key }),
}));

afterEach(cleanup);

describe("ActionDropdown", () => {
  it("escapes clipping containers, skips hidden/disabled actions during keyboard navigation, and restores focus on Escape", async () => {
    const disabledAction = vi.fn();
    const { container } = render(<div style={{ overflow: "hidden" }}><ActionDropdown items={[
      { label: "Unavailable", disabled: true, onClick: disabledAction },
      { label: "Hidden", hidden: true },
      { label: "Inspect" },
      { variant: "separator" },
      { label: "Download" },
    ]} /></div>);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(document.body).toContainElement(menu);
    expect(container).not.toContainElement(menu);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(screen.queryByRole("menuitem", { name: "Hidden" })).not.toBeInTheDocument();
    const unavailable = screen.getByRole("menuitem", { name: "Unavailable" });
    expect(unavailable).toBeDisabled();
    fireEvent.click(unavailable);
    expect(disabledAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Inspect" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Download" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Inspect" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Download" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Inspect" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("isolates table row clicks and closes after an enabled action", () => {
    const rowAction = vi.fn();
    const inspect = vi.fn();
    render(<div onClick={rowAction}><ActionDropdown items={[{ label: "Inspect", onClick: inspect }]} /></div>);
    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Inspect" }));
    expect(inspect).toHaveBeenCalledOnce();
    expect(rowAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("dismisses on outside pointer interaction and disables an empty or explicitly disabled menu", () => {
    const { rerender } = render(<ActionDropdown items={[{ label: "Inspect" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    rerender(<ActionDropdown items={[{ label: "Hidden", hidden: true }]} />);
    expect(screen.getByRole("button", { name: "Actions" })).toBeDisabled();
    rerender(<ActionDropdown disabled items={[{ label: "Inspect" }]} />);
    expect(screen.getByRole("button", { name: "Actions" })).toBeDisabled();
  });
});

describe("Modal", () => {
  it("assigns distinct accessible titles to simultaneous portal dialogs", () => {
    const { container } = render(<>
      <Modal open title="First modal" onClose={vi.fn()}>First content</Modal>
      <Modal open title="Second modal" onClose={vi.fn()}>Second content</Modal>
    </>);
    const first = screen.getByRole("dialog", { name: "First modal" });
    const second = screen.getByRole("dialog", { name: "Second modal" });
    expect(first.getAttribute("aria-labelledby")).not.toBe(second.getAttribute("aria-labelledby"));
    expect(first).toHaveAttribute("aria-modal", "true");
    expect(container).not.toContainElement(first);
    expect(container).not.toContainElement(second);
  });

  it("focuses inside, traps Tab in both directions, closes on Escape, and restores the opener", async () => {
    const close = vi.fn();
    const view = (open: boolean) => <><button>Open details</button><Modal open={open} title="Details" onClose={close}>
      <input aria-label="Device name" /><button>Save</button>
    </Modal></>;
    const { rerender } = render(view(false));
    const opener = screen.getByRole("button", { name: "Open details" });
    opener.focus();
    rerender(view(true));
    const first = screen.getByRole("button", { name: "Close dialog" });
    const last = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    rerender(view(false));
    expect(opener).toHaveFocus();
  });

  it("requires caller actions for explicitClose dialogs and contains focus even without controls", async () => {
    const close = vi.fn();
    render(<Modal open explicitClose title="Provisioning complete" onClose={close}>Keep this secret</Modal>);
    const dialog = screen.getByRole("dialog", { name: "Provisioning complete" });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog", () => {
  it("blocks close, cancellation, and repeated confirmation while processing", () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    render(<ConfirmDialog open title="Delete device" loading onCancel={cancel} onConfirm={confirm} />);
    const dialog = screen.getByRole("alertdialog", { name: "Delete device" });
    for (const button of within(dialog).getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(cancel).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("requires exact destructive confirmation, announces errors, and clears the value on reopening", async () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    const view = (open: boolean) => <ConfirmDialog open={open} title="Delete device" description="This removes the device."
      confirmationText="device-1" confirmationLabel="Device identifier" error="Request failed" onCancel={cancel} onConfirm={confirm} />;
    const { rerender } = render(view(true));
    const input = screen.getByRole("textbox", { name: "Device identifier" });
    await waitFor(() => expect(input).toHaveFocus());
    const button = screen.getByRole("button", { name: "Confirm" });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "DEVICE-1" } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "device-1" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("alertdialog", { name: "Delete device" });
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)).toHaveTextContent("This removes the device.");
    expect(document.getElementById(dialog.getAttribute("aria-errormessage")!)).toBe(screen.getByRole("alert"));
    rerender(view(false));
    rerender(view(true));
    expect(screen.getByRole("textbox", { name: "Device identifier" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

type Row = { id: string; name: string };
const rows: Row[] = Array.from({ length: 23 }, (_, index) => ({ id: String(index + 1), name: `Device ${index + 1}` }));
const columns: Column<Row>[] = [{ key: "name", header: "Device", sortable: true, sortValue: row => Number(row.id), render: row => row.name }];

describe("DataTable", () => {
  it("renders every supplied server-page record without a second pagination footer", () => {
    render(<DataTable data={rows} columns={columns} rowKey={row => row.id} hidePagination />);
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
    expect(screen.getByRole("cell", { name: "Device 23" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trang sau" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("clamps the page after data shrinks and keeps useful single-page controls", () => {
    const view = (data: Row[]) => <DataTable data={data} columns={columns} rowKey={row => row.id} />;
    const { rerender } = render(view(rows));
    const next = screen.getByRole("button", { name: "Trang sau" });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByRole("cell", { name: "Device 21" })).toBeInTheDocument();
    rerender(view(rows.slice(0, 11)));
    expect(screen.getByRole("cell", { name: "Device 11" })).toBeInTheDocument();
    expect(screen.getByText("11–11 / 11")).toBeInTheDocument();
    expect(next).toBeDisabled();
    rerender(view(rows.slice(0, 3)));
    expect(screen.getByText("1–3 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
    rerender(view([]));
    expect(screen.getByText("No data available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trang sau" })).not.toBeInTheDocument();
  });

  it("supports row Enter/Space activation without hijacking nested control keyboard events", () => {
    const select = vi.fn();
    const inspect = vi.fn();
    const actionColumns: Column<Row>[] = [...columns, { key: "action", header: "Action", render: () => <button onClick={event => { event.stopPropagation(); inspect(); }}>Inspect</button> }];
    render(<DataTable data={rows.slice(0, 1)} columns={actionColumns} rowKey={row => row.id} onRowClick={select} />);
    const row = screen.getByRole("cell", { name: "Device 1" }).closest("tr")!;
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith(rows[0]);
    const button = screen.getByRole("button", { name: "Inspect" });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
    fireEvent.click(button);
    expect(select).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("sorts through ascending/descending/unsorted states and resets pagination", () => {
    render(<DataTable data={rows} columns={columns} rowKey={row => row.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    const sort = screen.getByRole("button", { name: "Device" });
    fireEvent.click(sort);
    expect(screen.getByRole("columnheader", { name: "Device" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("cell", { name: "Device 1" })).toBeInTheDocument();
    fireEvent.click(sort);
    expect(screen.getByRole("columnheader", { name: "Device" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("cell", { name: "Device 23" })).toBeInTheDocument();
    fireEvent.click(sort);
    expect(screen.getByRole("columnheader", { name: "Device" })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("cell", { name: "Device 1" })).toBeInTheDocument();
  });
});
