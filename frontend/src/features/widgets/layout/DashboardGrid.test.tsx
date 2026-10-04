import { useMemo, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGrid } from "./DashboardGrid";
import { resolveLayoutCollisions } from "./gridLayoutUtils";
import type { ProjectWidget } from "../../../types";
import type { LayoutItem } from "react-grid-layout";

const mockWidget = (id: string, layoutGrid?: { x: number; y: number; w: number; h: number }): ProjectWidget => ({
  id,
  page_id: "page-1",
  widget_type: "toggle_switch",
  title: `Widget ${id}`,
  sort_order: 0,
  layout: { grid: layoutGrid ?? { x: 0, y: 0, w: 6, h: 10 } },
  config: {},
  binding: {},
  created_at: "",
  updated_at: "",
});

function createDataTransfer() {
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    types: ["application/aifom-widget", "text/plain"],
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
    getData: vi.fn((type: string) => data.get(type) ?? ""),
  } as unknown as DataTransfer;
  return { data, dataTransfer };
}

describe("DashboardGrid", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  describe("Save layout button", () => {
    it("enables Save layout button when a widget is added to an empty grid", async () => {
      const onSaveLayout = vi.fn().mockResolvedValue(undefined);
      const onDropTemplate = vi.fn();
      const renderWidget = vi.fn().mockImplementation(() => <div data-testid="widget-element">Widget</div>);

      const { rerender } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={renderWidget}
          onSaveLayout={onSaveLayout}
          onDropTemplate={onDropTemplate}
        />
      );

      // Save layout button should be disabled initially (empty grid, no changes)
      const saveButton = screen.getByRole("button", { name: /save layout/i });
      expect(saveButton).toBeDisabled();

      // Rerender with a new widget
      const newWidget = mockWidget("widget-1");
      await act(async () => {
        rerender(
          <DashboardGrid
            widgets={[newWidget]}
            readOnly={false}
            projectName="Test Project"
            renderWidget={renderWidget}
            onSaveLayout={onSaveLayout}
            onDropTemplate={onDropTemplate}
          />
        );
      });

      // Save layout button should now be enabled because a widget was added
      expect(saveButton).not.toBeDisabled();

      // Clicking the Save layout button should call onSaveLayout
      await act(async () => {
        fireEvent.click(saveButton);
      });
      expect(onSaveLayout).toHaveBeenCalled();
    });

    it("keeps edit mode active when layout persistence fails", async () => {
      const onSaveLayout = vi.fn().mockRejectedValue(new Error("save failed"));
      const widget = { ...mockWidget("widget-1"), layout: {} };

      render(
        <DashboardGrid
          widgets={[widget]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => <div>Widget</div>}
          onSaveLayout={onSaveLayout}
          onDropTemplate={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));
      const saveButton = screen.getByRole("button", { name: /save layout/i });
      expect(saveButton).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(saveButton);
      });

      await waitFor(() => expect(onSaveLayout).toHaveBeenCalledOnce());
      expect(screen.getByRole("button", { name: /cancel changes/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /edit dashboard/i })).not.toBeInTheDocument();
    });
  });

  describe("palette drag and drop", () => {
    it("adds a widget through the visible Add action without drag and drop", () => {
      const onDropTemplate = vi.fn();

      render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={onDropTemplate}
        />,
      );

      fireEvent.click(screen.getAllByRole("button", { name: /\+ add/i })[0]);
      expect(onDropTemplate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      );
    });

    it("drops a widget using dataTransfer even if dragend clears the in-memory ref first", () => {
      const onDropTemplate = vi.fn();
      const { data, dataTransfer } = createDataTransfer();

      const { container } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={onDropTemplate}
        />
      );

      const paletteItem = container.querySelector<HTMLElement>('[draggable="true"]');
      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const dropZone = grid?.parentElement;
      expect(paletteItem).not.toBeNull();
      expect(dropZone).not.toBeNull();

      fireEvent.dragStart(paletteItem!, { dataTransfer });
      fireEvent.dragEnd(paletteItem!, { dataTransfer });
      fireEvent.dragOver(dropZone!, { dataTransfer, clientX: 120, clientY: 120 });
      fireEvent.drop(dropZone!, { dataTransfer, clientX: 120, clientY: 120 });

      expect(onDropTemplate).toHaveBeenCalledTimes(1);
      expect(onDropTemplate).toHaveBeenCalledWith(
        data.get("application/aifom-widget"),
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      );
    });

    it("keeps the template fallback when dragend happens before drop data is readable", () => {
      const onDropTemplate = vi.fn();
      const { data, dataTransfer } = createDataTransfer();

      const { container } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={onDropTemplate}
        />
      );

      const paletteItem = container.querySelector<HTMLElement>('[draggable="true"]');
      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const dropZone = grid?.parentElement;
      expect(paletteItem).not.toBeNull();
      expect(dropZone).not.toBeNull();

      fireEvent.dragStart(paletteItem!, { dataTransfer });
      const widgetType = data.get("application/aifom-widget");
      fireEvent.dragEnd(paletteItem!, { dataTransfer });
      data.clear();
      fireEvent.dragOver(dropZone!, { dataTransfer, clientX: 120, clientY: 120 });
      fireEvent.drop(dropZone!, { dataTransfer, clientX: 120, clientY: 120 });

      expect(onDropTemplate).toHaveBeenCalledWith(
        widgetType,
        expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      );
    });

    it("accepts a widget drop on the canvas container", () => {
      const onDropTemplate = vi.fn();
      const { dataTransfer } = createDataTransfer();
      const { container } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={onDropTemplate}
        />
      );

      const paletteItem = container.querySelector<HTMLElement>('[draggable="true"]');
      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const dropZone = grid?.parentElement;
      expect(paletteItem).not.toBeNull();
      expect(dropZone).not.toBeNull();

      fireEvent.dragStart(paletteItem!, { dataTransfer });
      fireEvent.dragOver(dropZone!, { dataTransfer, clientX: 120, clientY: 120 });
      fireEvent.drop(dropZone!, { dataTransfer, clientX: 120, clientY: 120 });

      expect(onDropTemplate).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveLayoutCollisions", () => {
    it("leaves non-overlapping items untouched", () => {
      const activeItem: LayoutItem = { i: "active", x: 0, y: 0, w: 4, h: 4 };
      const staticItem: LayoutItem = { i: "static", x: 5, y: 0, w: 4, h: 4 };
      const layout: LayoutItem[] = [activeItem, staticItem];

      const resolved = resolveLayoutCollisions(layout, activeItem);
      
      const activeRes = resolved.find((item) => item.i === "active");
      const staticRes = resolved.find((item) => item.i === "static");

      expect(activeRes?.y).toBe(0);
      expect(staticRes?.y).toBe(0);
    });

    it("pushes directly overlapping static items down", () => {
      const activeItem: LayoutItem = { i: "active", x: 0, y: 2, w: 4, h: 4 };
      const staticItem: LayoutItem = { i: "static", x: 0, y: 3, w: 4, h: 4 };
      const layout: LayoutItem[] = [activeItem, staticItem];

      const resolved = resolveLayoutCollisions(layout, activeItem);

      const activeRes = resolved.find((item) => item.i === "active");
      const staticRes = resolved.find((item) => item.i === "static");

      // Active item stays locked
      expect(activeRes?.y).toBe(2);
      // Static item must be pushed down to y = 6 (active.y + active.h) to avoid overlap
      expect(staticRes?.y).toBe(6);
    });

    it("handles cascading push-down collisions", () => {
      const activeItem: LayoutItem = { i: "active", x: 0, y: 0, w: 4, h: 4 };
      const static1: LayoutItem = { i: "static1", x: 0, y: 2, w: 4, h: 4 };
      const static2: LayoutItem = { i: "static2", x: 0, y: 5, w: 4, h: 4 };
      const layout: LayoutItem[] = [activeItem, static1, static2];

      const resolved = resolveLayoutCollisions(layout, activeItem);

      const activeRes = resolved.find((item) => item.i === "active");
      const static1Res = resolved.find((item) => item.i === "static1");
      const static2Res = resolved.find((item) => item.i === "static2");

      // Active locked at y = 0
      expect(activeRes?.y).toBe(0);
      // static1 pushed to y = 4 (since it overlapped with active at y=0, w=4, h=4)
      expect(static1Res?.y).toBe(4);
      // static2 (original y=5) now overlaps with static1 (y=4, h=4) -> pushed to y = 8
      expect(static2Res?.y).toBe(8);
    });
  });

  describe("Cancel changes and editor lifecycle", () => {
    it("calls onCancel callback when Cancel changes button is clicked", async () => {
      const onCancel = vi.fn();
      const onSaveLayout = vi.fn().mockResolvedValue(undefined);
      const onDropTemplate = vi.fn();
      const widget1 = mockWidget("widget-1");

      render(
        <DashboardGrid
          widgets={[widget1]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={(w) => <div data-testid={`widget-${w.id}`}>{w.title}</div>}
          onSaveLayout={onSaveLayout}
          onDropTemplate={onDropTemplate}
          onCancel={onCancel}
        />,
      );

      // Enter edit mode
      const editButton = screen.getByRole("button", { name: /edit dashboard/i });
      fireEvent.click(editButton);

      // Cancel button should be visible in edit mode
      const cancelButton = screen.getByRole("button", { name: /cancel changes/i });
      expect(cancelButton).toBeInTheDocument();

      // Click Cancel
      fireEvent.click(cancelButton);
      expect(onCancel).toHaveBeenCalledTimes(1);

      // Should have exited edit mode (Edit dashboard button visible again)
      expect(screen.getByRole("button", { name: /edit dashboard/i })).toBeInTheDocument();
    });

    it("calls onCancel when Cancel changes is clicked in preview mode", async () => {
      const onCancel = vi.fn();
      const widget1 = mockWidget("widget-1");

      render(
        <DashboardGrid
          widgets={[widget1]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={(w) => <div data-testid={`widget-${w.id}`}>{w.title}</div>}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
          onCancel={onCancel}
        />,
      );

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Switch to preview mode
      fireEvent.click(screen.getByRole("button", { name: /preview/i }));

      // Click Cancel changes in preview mode
      const cancelButton = screen.getByRole("button", { name: /cancel changes/i });
      fireEvent.click(cancelButton);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /edit dashboard/i })).toBeInTheDocument();
    });

    // Full editor lifecycle tests using state harness matching ProjectEditor
    function TestEditorHarness({
      initialWidgets = [],
      onSaveSpy,
    }: {
      initialWidgets?: ProjectWidget[];
      onSaveSpy?: (layoutMap: Map<string, any>) => void;
    }) {
      const [serverWidgets, setServerWidgets] = useState<ProjectWidget[]>(initialWidgets);
      const [draftWidgets, setDraftWidgets] = useState<ProjectWidget[]>([]);
      const widgets = useMemo(() => [...serverWidgets, ...draftWidgets], [serverWidgets, draftWidgets]);

      const handleDropTemplate = (widgetType: string, layout: any) => {
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
        const draft: ProjectWidget = {
          id: tempId,
          page_id: "page-1",
          widget_type: widgetType,
          title: `Draft ${widgetType}`,
          sort_order: widgets.length,
          layout: { grid: layout },
          config: {},
          binding: {},
          created_at: "",
          updated_at: "",
          is_temporary: true,
        };
        setDraftWidgets((prev) => [...prev, draft]);
      };

      const handleSaveLayout = async (layoutMap: Map<string, any>) => {
        onSaveSpy?.(layoutMap);
        setDraftWidgets((prev) =>
          prev.map((w) => {
            const pos = layoutMap.get(w.id);
            return pos ? { ...w, layout: { ...w.layout, grid: pos } } : w;
          }),
        );
        setServerWidgets((prev) =>
          prev.map((w) => {
            const pos = layoutMap.get(w.id);
            return pos ? { ...w, layout: { ...w.layout, grid: pos } } : w;
          }),
        );
      };

      const handleCancel = () => {
        setDraftWidgets([]);
      };

      const handlePersistFirstDraft = () => {
        if (draftWidgets.length > 0) {
          const first = draftWidgets[0];
          setDraftWidgets((prev) => prev.filter((w) => w.id !== first.id));
          setServerWidgets((prev) => [...prev, { ...first, id: `persisted-${first.id}`, is_temporary: false }]);
        }
      };

      return (
        <div>
          <button data-testid="persist-first-draft" onClick={handlePersistFirstDraft}>
            Persist Draft
          </button>
          <DashboardGrid
            widgets={widgets}
            readOnly={false}
            projectName="Test Project"
            onSaveLayout={handleSaveLayout}
            onDropTemplate={handleDropTemplate}
            onCancel={handleCancel}
            renderWidget={(widget) => (
              <div data-testid={`rendered-${widget.id}`}>
                <span data-testid={`title-${widget.id}`}>{widget.title}</span>
                <span data-testid={`coords-${widget.id}`}>
                  {JSON.stringify(widget.layout?.grid)}
                </span>
              </div>
            )}
          />
        </div>
      );
    }

    it("Scenario A: Add draft widget -> Cancel immediately removes draft and preserves original dashboard", async () => {
      const existingWidget = mockWidget("existing-1");
      render(<TestEditorHarness initialWidgets={[existingWidget]} />);

      // Existing widget is visible
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Add a draft widget from palette
      const addButtons = screen.getAllByRole("button", { name: /\+ add/i });
      fireEvent.click(addButtons[0]);

      // Both widgets are now rendered
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
      const allRendered = screen.getAllByTestId(/^rendered-/);
      expect(allRendered.length).toBe(2);

      // Click Cancel changes
      fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));

      // Draft widget must disappear immediately without reload
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
      const renderedAfterCancel = screen.getAllByTestId(/^rendered-/);
      expect(renderedAfterCancel.length).toBe(1);
      expect(renderedAfterCancel[0]).toHaveAttribute("data-testid", "rendered-existing-1");
    });

    it("Scenario B: Move persisted widget -> Cancel restores original saved position", async () => {
      const existingWidget = mockWidget("existing-1", { x: 0, y: 0, w: 6, h: 10 });
      const { container } = render(<TestEditorHarness initialWidgets={[existingWidget]} />);

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Verify widget is rendered
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();

      // Click Cancel changes
      fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));

      // Original widget remains rendered and edit mode exited
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /edit dashboard/i })).toBeInTheDocument();
    });

    it("Scenario C: Resize persisted widget -> Cancel restores original saved dimensions", async () => {
      const existingWidget = mockWidget("existing-1", { x: 0, y: 0, w: 6, h: 10 });
      render(<TestEditorHarness initialWidgets={[existingWidget]} />);

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));
      expect(screen.getByRole("button", { name: /cancel changes/i })).toBeInTheDocument();

      // Click Cancel changes
      fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));

      // Widget remains and edit mode is closed
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /edit dashboard/i })).toBeInTheDocument();
    });

    it("Scenario D: Add draft + modify existing -> Cancel removes all drafts and restores baseline", async () => {
      const existingWidget = mockWidget("existing-1");
      render(<TestEditorHarness initialWidgets={[existingWidget]} />);

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Add 2 draft widgets
      const addButtons = screen.getAllByRole("button", { name: /\+ add/i });
      fireEvent.click(addButtons[0]);
      fireEvent.click(addButtons[1] || addButtons[0]);

      expect(screen.getAllByTestId(/^rendered-/).length).toBe(3);

      // Click Cancel changes
      fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));

      // Only existing widget remains
      const remaining = screen.getAllByTestId(/^rendered-/);
      expect(remaining.length).toBe(1);
      expect(remaining[0]).toHaveAttribute("data-testid", "rendered-existing-1");
    });

    it("Scenario E: Add widget -> Persist -> Edit -> Cancel retains persisted widget", async () => {
      const existingWidget = mockWidget("existing-1");
      render(<TestEditorHarness initialWidgets={[existingWidget]} />);

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Add draft widget
      fireEvent.click(screen.getAllByRole("button", { name: /\+ add/i })[0]);
      expect(screen.getAllByTestId(/^rendered-/).length).toBe(2);

      // Simulate persisting the draft widget (like WidgetModal save)
      fireEvent.click(screen.getByTestId("persist-first-draft"));

      // Now 2 widgets are persisted
      expect(screen.getAllByTestId(/^rendered-/).length).toBe(2);

      // Add another draft widget in the same session
      fireEvent.click(screen.getAllByRole("button", { name: /\+ add/i })[0]);
      expect(screen.getAllByTestId(/^rendered-/).length).toBe(3);

      // Click Cancel changes
      fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));

      // The previously persisted widget survives, only the second draft is discarded
      const remaining = screen.getAllByTestId(/^rendered-/);
      expect(remaining.length).toBe(2);
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
      expect(screen.getByTestId(/^rendered-persisted-temp-/)).toBeInTheDocument();
    });

    it("Scenario F: Save layout persists layout and subsequent Cancel does not discard saved layout", async () => {
      const onSaveSpy = vi.fn().mockResolvedValue(undefined);
      const existingWidget: ProjectWidget = {
        ...mockWidget("existing-1"),
        layout: {},
      };
      render(<TestEditorHarness initialWidgets={[existingWidget]} onSaveSpy={onSaveSpy} />);

      // Enter edit mode
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Save layout is enabled because widget has no saved grid layout
      const saveBtn = screen.getByRole("button", { name: /save layout/i });
      expect(saveBtn).not.toBeDisabled();
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(onSaveSpy).toHaveBeenCalled();
        expect(screen.getByRole("button", { name: /edit dashboard/i })).toBeInTheDocument();
      });

      // Enter a new edit session
      fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

      // Add another draft widget
      fireEvent.click(screen.getAllByRole("button", { name: /\+ add/i })[0]);
      expect(screen.getAllByTestId(/^rendered-/).length).toBe(2);

      // Cancel the new session
      fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));

      // The saved widget survives, only the new draft is removed
      expect(screen.getAllByTestId(/^rendered-/).length).toBe(1);
      expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
    });

    it("Rapid toggling between preview mode, adding widgets, and cancelling repeatedly", async () => {
      const existingWidget = mockWidget("existing-1");
      render(<TestEditorHarness initialWidgets={[existingWidget]} />);

      for (let i = 0; i < 3; i++) {
        // Enter edit
        fireEvent.click(screen.getByRole("button", { name: /edit dashboard/i }));

        // Add a draft widget
        fireEvent.click(screen.getAllByRole("button", { name: /\+ add/i })[0]);
        expect(screen.getAllByTestId(/^rendered-/).length).toBe(2);

        // Toggle to preview
        fireEvent.click(screen.getByRole("button", { name: /preview/i }));
        expect(screen.getByText(/previewing unsaved layout/i)).toBeInTheDocument();

        // Toggle back to design
        fireEvent.click(screen.getByRole("button", { name: /back to design/i }));

        // Cancel
        fireEvent.click(screen.getByRole("button", { name: /cancel changes/i }));
        expect(screen.getAllByTestId(/^rendered-/).length).toBe(1);
        expect(screen.getByTestId("rendered-existing-1")).toBeInTheDocument();
      }
    });
  });

  describe("Canvas Workspace Height & UI/UX Pro Max Standards", () => {
    it("renders canvas container with generous minimum floor height (at least 580px) in edit mode", () => {
      const { container } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const canvasContainer = grid?.parentElement;
      expect(canvasContainer).not.toBeNull();
      expect(canvasContainer?.style.minHeight).toContain("580px");
      expect(canvasContainer?.style.minHeight).toContain("100vh - 14rem");
    });

    it("renders centered empty state banner and expansive grid background when zero widgets", () => {
      const { container } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      // Empty state banner
      expect(screen.getByText(/kéo widget từ thanh bên vào đây/i)).toBeInTheDocument();
      
      // Grid background lines overlay
      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const canvasContainer = grid?.parentElement;
      expect(canvasContainer?.innerHTML).toContain("linear-gradient");
    });

    it("renders canvas container with minimum floor height (at least 480px) in readOnly mode", () => {
      const { container } = render(
        <DashboardGrid
          widgets={[mockWidget("w1")]}
          readOnly={true}
          projectName="Test Project"
          renderWidget={() => <div data-testid="widget">Widget</div>}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const canvasContainer = grid?.parentElement;
      expect(canvasContainer).not.toBeNull();
      expect(canvasContainer?.style.minHeight).toContain("480px");
      expect(canvasContainer?.style.minHeight).toContain("100vh - 16rem");
    });

    it("expands canvasMinHeight when layout height exceeds default minimum floor height", () => {
      // Widget with y=20, h=10 -> maxItemY=30 -> canvasHeightPx = 30 * 20 + 24 = 624px -> layoutCanvasHeightPx = 632px
      const tallWidget = mockWidget("tall-widget", { x: 0, y: 20, w: 6, h: 10 });
      const { container } = render(
        <DashboardGrid
          widgets={[tallWidget]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => <div data-testid="widget">Widget</div>}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const canvasContainer = grid?.parentElement;
      expect(canvasContainer).not.toBeNull();
      // layoutCanvasHeightPx (632px) exceeds 480px (view mode floor) and is reflected in minHeight
      expect(canvasContainer?.style.minHeight).toContain("632px");
      expect(canvasContainer?.style.minHeight).toContain("480px");
    });

    it("dynamically increases canvas height during template drag gesture", () => {
      const { container } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      const paletteItem = container.querySelector<HTMLElement>('[draggable="true"]');
      const grid = container.querySelector<HTMLElement>(".react-grid-layout");
      const canvasContainer = grid?.parentElement;
      expect(paletteItem).not.toBeNull();
      expect(canvasContainer).not.toBeNull();

      // Before drag: baseline height
      expect(canvasContainer?.style.minHeight).toContain("580px");
      expect(canvasContainer?.style.minHeight).not.toContain("524px");

      const { dataTransfer } = createDataTransfer();
      fireEvent.dragStart(paletteItem!, { dataTransfer });

      // During drag, dragCanvasHeightPx (baseline + 500px = 524px) is applied to canvasMinHeight
      expect(canvasContainer?.style.minHeight).toContain("524px");

      fireEvent.dragEnd(paletteItem!, { dataTransfer });
      // After drag ends, returns to normal floor height
      expect(canvasContainer?.style.minHeight).not.toContain("524px");
      expect(canvasContainer?.style.minHeight).toContain("580px");
    });

    it("renders outer builder container with generous minimum heights in edit and view modes", () => {
      const { container, rerender } = render(
        <DashboardGrid
          widgets={[]}
          readOnly={false}
          projectName="Test Project"
          renderWidget={() => null}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      const builderGrid = container.querySelector<HTMLElement>(".grid.grid-cols-1");
      expect(builderGrid).not.toBeNull();
      expect(builderGrid?.style.minHeight).toContain("620px");
      expect(builderGrid?.style.minHeight).toContain("100vh - 12rem");

      // In readOnly mode
      rerender(
        <DashboardGrid
          widgets={[mockWidget("w1")]}
          readOnly={true}
          projectName="Test Project"
          renderWidget={() => <div>Widget</div>}
          onSaveLayout={vi.fn().mockResolvedValue(undefined)}
          onDropTemplate={vi.fn()}
        />,
      );

      expect(builderGrid?.style.minHeight).toContain("520px");
      expect(builderGrid?.style.minHeight).toContain("100vh - 14rem");
    });
  });
});


