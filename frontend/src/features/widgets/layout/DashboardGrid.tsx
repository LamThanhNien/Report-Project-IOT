import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { ResponsiveGridLayout as ResponsiveGridLayoutBase, useContainerWidth, noCompactor } from "react-grid-layout";
const ResponsiveGridLayout = ResponsiveGridLayoutBase as React.ElementType;
import type { Layout, LayoutItem } from "react-grid-layout";
import {
  Eye,
  GripVertical,
  LayoutDashboard,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import type { ProjectWidget } from "../../../types";
import { listWidgetDefinitions } from "../registry/widgetRegistry";
import type { WidgetDefinition } from "../types";
import {
  buildDefaultLayoutMap,
  buildGridLayout,
  getWidgetSizeConstraints,
  GRID_COLUMNS,
  GRID_CONTAINER_PADDING,
  GRID_MARGIN,
  GRID_ROW_HEIGHT,
  layoutToGridMap,
  layoutsChanged,
  normalizeGridLayout,
  resolveLayoutCollisions,
} from "./gridLayoutUtils";
import type { GridLayoutData } from "./gridLayoutUtils";
import { DragPerformanceProvider } from "../dragPerformanceContext";
import { useConfirm } from "../../../contexts/ConfirmContext";
import { useToast } from "../../../contexts/ToastContext";

export interface DashboardGridProps {
  widgets: ProjectWidget[];
  readOnly: boolean;
  projectName: string;
  /** Optional fixed column contract for non-tenant canvases such as templates. */
  columns?: number;
  renderWidget: (widget: ProjectWidget, isEditing: boolean) => ReactNode;
  onSaveLayout: (layoutMap: Map<string, GridLayoutData>) => Promise<void>;
  onDropTemplate: (widgetType: string, layout: GridLayoutData) => void;
  onCancel?: () => void;
}

const GROUP_LABELS_KEYS = {
  chart: "dashboard:palette.group_chart",
  control: "dashboard:palette.group_control",
  device: "dashboard:palette.group_device",
  ota: "dashboard:palette.group_ota",
  utility: "dashboard:palette.group_utility",
} as const;

type PaletteGroup = keyof typeof GROUP_LABELS_KEYS;

function paletteGroup(definition: WidgetDefinition): PaletteGroup {
  const id = definition.id.toLowerCase();
  if (definition.category === "chart") return "chart";
  if (definition.category === "control") return "control";
  if (id.includes("ota") || id.includes("firmware")) return "ota";
  if (definition.category === "utility") return "utility";
  return "device";
}

function buildDropLayout(definition: WidgetDefinition, item: LayoutItem): GridLayoutData {
  const constraints = getWidgetSizeConstraints(definition.id);
  return {
    x: Math.max(0, item.x),
    y: Math.max(0, item.y),
    w: Math.max(constraints.minW, item.w),
    h: Math.max(constraints.minH, item.h),
    minW: constraints.minW,
    minH: constraints.minH,
  };
}

function layoutsEqual(a: LayoutItem[], b: LayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  const otherById = new Map(b.map((item) => [item.i, item]));
  return a.every((item) => {
    const other = otherById.get(item.i);
    return Boolean(
      other &&
        item.x === other.x &&
        item.y === other.y &&
        item.w === other.w &&
        item.h === other.h,
    );
  });
}

interface CollidableItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function itemsCollide(a: CollidableItem, b: CollidableItem): boolean {
  if (a.x + a.w <= b.x) return false;
  if (b.x + b.w <= a.x) return false;
  if (a.y + a.h <= b.y) return false;
  if (b.y + b.h <= a.y) return false;
  return true;
}

export function DashboardGrid({
  widgets,
  readOnly,
  projectName,
  columns,
  renderWidget,
  onSaveLayout,
  onDropTemplate,
  onCancel,
}: DashboardGridProps) {
  const { t } = useTranslation(["projects", "dashboard"]);
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const confirm = useConfirm();
  const toast = useToast();

  const [requestedEditing, setIsEditing] = usePersistedState(
    `aifom_dashboard_editing_${projectId}`,
    !readOnly && widgets.length === 0,
    "session"
  );
  const [requestedPreviewMode, setIsPreviewMode] = usePersistedState(
    `aifom_dashboard_preview_${projectId}`,
    false,
    "session"
  );
  const isEditing = !readOnly && requestedEditing;
  const isPreviewMode = !readOnly && requestedPreviewMode;
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(null);
  const draggingTemplateRef = useRef<WidgetDefinition | null>(null);
  // Keep the last template available until drop is handled. Some Chromium
  // builds dispatch dragend before drop, which otherwise clears the only
  // in-memory fallback before the canvas can resolve the widget type.
  const pendingTemplateRef = useRef<{ definition: WidgetDefinition; expiresAt: number } | null>(null);
  const isDraggingRef = useRef(false);
  const activeDragItemRef = useRef<LayoutItem | null>(null);
  const dragStartLayoutRef = useRef<Map<string, LayoutItem> | null>(null);
  const lastDragPreviewRef = useRef<LayoutItem[] | null>(null);
  const pendingDragItemRef = useRef<LayoutItem | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const canvasHeightPxRef = useRef(0);
  const [dragCanvasHeightPx, setDragCanvasHeightPx] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const { width: containerWidth, containerRef, mounted } = useContainerWidth();

  const dynamicCols = useMemo(() => {
    if (columns) return columns;
    if (!containerWidth || containerWidth <= 150) return GRID_COLUMNS;

    // Base cellWidth at 1200px container width is 41.33px
    const baseCellWidth = (1200 - GRID_CONTAINER_PADDING[0] * 2 - GRID_MARGIN[0] * 23) / 24;
    const computedCols = Math.round(
      (containerWidth - GRID_CONTAINER_PADDING[0] * 2 + GRID_MARGIN[0]) / (baseCellWidth + GRID_MARGIN[0])
    );

    return Math.max(12, computedCols);
  }, [columns, containerWidth]);

  const savedLayout = useMemo(() => buildGridLayout(widgets, dynamicCols) as Layout, [widgets, dynamicCols]);
  const savedGridMap = useMemo(() => layoutToGridMap(savedLayout as LayoutItem[]), [savedLayout]);
  const [workingLayout, setWorkingLayout] = useState<Layout>(savedLayout);
  const renderedLayout = useMemo(() => {
    if (isDragging) {
      return workingLayout;
    }
    const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
    return normalizeGridLayout(workingLayout as LayoutItem[], widgetTypeMap, dynamicCols);
  }, [workingLayout, widgets, dynamicCols, isDragging]);

  const workingGridMap = useMemo(() => layoutToGridMap(renderedLayout as LayoutItem[]), [renderedLayout]);
  const [initialGridMap, setInitialGridMap] = useState<Map<string, GridLayoutData> | null>(null);

  useEffect(() => {
    if (isEditing) {
      if (!initialGridMap) {
        setInitialGridMap(savedGridMap);
      }
    } else {
      setInitialGridMap(null);
    }
  }, [isEditing, savedGridMap, initialGridMap]);

  const customCompactor = useMemo(() => ({
    type: null,
    // Let resolveLayoutCollisions be the only collision authority during drag.
    // RGL passes this flag to moveElement(); when false, native collision
    // displacement happens before compact() and competes with our baseline
    // based resolver, which can make the first drag preview oscillate.
    allowOverlap: true,
    compact(layout: LayoutItem[]) {
      const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
      if (activeDragItemRef.current) {
        const baseline = dragStartLayoutRef.current;
        const roundedActive = {
          ...activeDragItemRef.current,
          x: Math.round(activeDragItemRef.current.x),
          y: Math.round(activeDragItemRef.current.y),
        };
        // Rebuild every frame from the immutable drag-start snapshot. RGL's
        // layout may already contain native collision displacement; consuming
        // those static coordinates here would make the preview oscillate.
        const restored = baseline
          ? [...baseline.values()].map((item) => ({ ...item }))
          : layout.map((item) => ({ ...item }));
        return resolveLayoutCollisions(restored, roundedActive, widgetTypeMap, dynamicCols);
      }
      return normalizeGridLayout(layout, widgetTypeMap, dynamicCols);
    }
  }), [widgets, dynamicCols]);

  const [prevWidgets, setPrevWidgets] = useState<ProjectWidget[]>(widgets);
  const [prevIsEditing, setPrevIsEditing] = useState<boolean>(isEditing);
  const [prevIsPreviewMode, setPrevIsPreviewMode] = useState<boolean>(isPreviewMode);
  const [prevDynamicCols, setPrevDynamicCols] = useState<number>(dynamicCols);

  // Synchronize workingLayout with savedLayout/widgets/dynamicCols during render to prevent visual flashing.
  if (widgets !== prevWidgets || isEditing !== prevIsEditing || isPreviewMode !== prevIsPreviewMode || dynamicCols !== prevDynamicCols) {
    setPrevWidgets(widgets);
    setPrevIsEditing(isEditing);
    setPrevIsPreviewMode(isPreviewMode);
    setPrevDynamicCols(dynamicCols);

    if (!isEditing && !isPreviewMode) {
      setWorkingLayout(savedLayout);
    } else {
      const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
      
      // If dynamicCols changed, normalize the working layout to the new columns
      let currentWorking = workingLayout as LayoutItem[];
      if (dynamicCols !== prevDynamicCols) {
        currentWorking = normalizeGridLayout(currentWorking, widgetTypeMap, dynamicCols);
      }

      const prevMap = new Map(currentWorking.map((item) => [item.i, item]));
      const savedItems = savedLayout as LayoutItem[];
      const savedIds = new Set(savedItems.map((item) => item.i));

      const added = savedItems.filter((item) => !prevMap.has(item.i));
      const removed = currentWorking.filter((item) => !savedIds.has(item.i));

      if (added.length > 0 || removed.length > 0 || dynamicCols !== prevDynamicCols) {
        const nextItems = currentWorking.filter((item) => savedIds.has(item.i));
        for (const newItem of added) {
          nextItems.push(newItem);
        }
        const normalized = normalizeGridLayout(nextItems as LayoutItem[], widgetTypeMap, dynamicCols);
        setWorkingLayout(normalized as Layout);
      }
    }
  } else if (isEditing || isPreviewMode) {
    // Safety check: Ensure any new widget ID in savedLayout not yet in workingLayout is appended immediately
    const workingItems = workingLayout as LayoutItem[];
    const workingIds = new Set(workingItems.map((item) => item.i));
    const savedItems = savedLayout as LayoutItem[];
    const missing = savedItems.filter((item) => !workingIds.has(item.i));
    if (missing.length > 0) {
      const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
      const nextItems = [...workingItems, ...missing];
      const normalized = normalizeGridLayout(nextItems, widgetTypeMap, dynamicCols);
      setWorkingLayout(normalized as Layout);
    }
  }

  // Derive hasChanges instead of managing it in state/effects to prevent sync bugs
  const hasChanges = useMemo(() => {
    if (!isEditing && !isPreviewMode) return false;
    const baseMap = initialGridMap || savedGridMap;
    return layoutsChanged(workingGridMap, baseMap);
  }, [isEditing, isPreviewMode, workingGridMap, initialGridMap, savedGridMap]);

  const confirmDiscardChanges = useCallback(
    () => confirm({
      title: t("dashboard:palette.confirm_discard_title", "Discard unsaved changes?"),
      description: t("dashboard:palette.confirm_discard_changes", "You have unsaved layout changes. Discard them and leave this page?"),
      confirmLabel: t("dashboard:palette.discard_changes", "Discard changes"),
      cancelLabel: t("common:actions.cancel", "Cancel"),
      destructive: true,
    }),
    [confirm, t],
  );

  useEffect(() => {
    if (!hasChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleDocumentNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmDiscardChanges().then((accepted) => {
        if (!accepted) return;
        const nextUrl = `${destination.pathname}${destination.search}${destination.hash}`;
        window.history.pushState({}, "", nextUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentNavigation, true);
    };
  }, [confirmDiscardChanges, hasChanges]);

  const visibleDefinitions = useMemo(() => listWidgetDefinitions(paletteSearch), [paletteSearch]);
  const groupedDefinitions = useMemo(() => {
    return visibleDefinitions.reduce<Record<PaletteGroup, WidgetDefinition[]>>(
      (acc, definition) => {
        acc[paletteGroup(definition)].push(definition);
        return acc;
      },
      { chart: [], control: [], device: [], ota: [], utility: [] },
    );
  }, [visibleDefinitions]);

  useEffect(() => {
    if (readOnly) setIsEditing(false);
  }, [readOnly]);

  useEffect(() => {
    if (!readOnly && widgets.length === 0) {
      setIsEditing(true);
      setPaletteOpen(true);
    }
  }, [readOnly, widgets.length]);

  const enterEditMode = useCallback(() => {
    setWorkingLayout(savedLayout);
    setIsEditing(true);
    setIsPreviewMode(false);
    setPaletteOpen(true);
  }, [savedLayout]);

  const enterPreviewMode = useCallback(() => {
    setIsEditing(false);
    setIsPreviewMode(true);
    setPaletteOpen(false);
  }, []);

  const backToDesign = useCallback(() => {
    setIsEditing(true);
    setIsPreviewMode(false);
    setPaletteOpen(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setWorkingLayout(savedLayout);
    setIsEditing(false);
    setIsPreviewMode(false);
    setPaletteOpen(false);
    setIsDragging(false);
    onCancel?.();
  }, [savedLayout, onCancel]);

  const resetLayout = useCallback(() => {
    const defaultMap = buildDefaultLayoutMap(widgets);
    const defaultLayout = widgets.map((widget) => {
      const pos = defaultMap.get(widget.id)!;
      const constraints = getWidgetSizeConstraints(widget.widget_type);
      return {
        i: widget.id,
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        minW: constraints.minW,
        minH: constraints.minH,
      };
    }) as Layout;
    setWorkingLayout(normalizeGridLayout(defaultLayout as LayoutItem[], new Map(widgets.map((w) => [w.id, w.widget_type]))) as Layout);
  }, [widgets]);

  const saveLayout = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSaveLayout(workingGridMap);
      setIsEditing(false);
      setIsPreviewMode(false);
      setPaletteOpen(false);
    } catch (error) {
      // Keep the editor open so the caller can retry failed creates or
      // correct an invalid widget binding. The parent callback may already
      // have synchronized any operations that succeeded.
      toast.error(error);
    } finally {
      setIsSaving(false);
    }
  }, [workingGridMap, onSaveLayout, toast]);

  const handleLayoutChange = useCallback(
    (_layout: Layout) => {
      if (!isEditing || isDragging) return;
      const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
      const normalized = normalizeGridLayout(_layout as LayoutItem[], widgetTypeMap, dynamicCols);
      setWorkingLayout(normalized as Layout);
    },
    [isEditing, isDragging, widgets, dynamicCols],
  );

  const handleDragStart = useCallback((layout: Layout, oldItem: LayoutItem, newItem: LayoutItem) => {
    setIsDragging(true);
    setDragCanvasHeightPx(canvasHeightPxRef.current + 500);
    const baseline = new Map(
      (layout as LayoutItem[]).map((item) => [item.i, { ...item }]),
    );
    activeDragItemRef.current = { ...newItem };
    pendingDragItemRef.current = { ...newItem };
    lastDragPreviewRef.current = [...baseline.values()].map((item) => ({ ...item }));
    dragStartLayoutRef.current = new Map(
      [...baseline.entries()],
    );
  }, []);

  const handleDrag = useCallback(
    (_layout: Layout, _oldItem: LayoutItem, newItem: LayoutItem) => {
      const baseline = dragStartLayoutRef.current;
      if (!baseline) return;
      const roundedItem = { ...newItem, x: Math.round(newItem.x), y: Math.round(newItem.y) };
      activeDragItemRef.current = roundedItem;
      pendingDragItemRef.current = roundedItem;
      if (dragFrameRef.current !== null) return;

      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const active = pendingDragItemRef.current;
        if (!active || !dragStartLayoutRef.current) return;
        activeDragItemRef.current = active;
        const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
        const preview = resolveLayoutCollisions(
          [...baseline.values()].map((item) => ({ ...item })),
          active,
          widgetTypeMap,
          dynamicCols,
        );
        lastDragPreviewRef.current = preview.map((item) => ({ ...item }));
      });
    },
    [widgets, dynamicCols],
  );

  const handleDragStop = useCallback(
    (_layout: Layout, _oldItem: LayoutItem, newItem: LayoutItem) => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      const baseline = dragStartLayoutRef.current;
      const widgetTypeMap = new Map(widgets.map((w) => [w.id, w.widget_type]));
      const finalLayout = baseline && newItem
        ? resolveLayoutCollisions(
            [...baseline.values()].map((item) => ({ ...item })),
            { ...newItem, x: Math.round(newItem.x), y: Math.round(newItem.y) },
            widgetTypeMap,
            dynamicCols,
          )
        : lastDragPreviewRef.current ?? (_layout as LayoutItem[]).map((item) => ({ ...item }));

      setIsDragging(false);
      setDragCanvasHeightPx(null);
      activeDragItemRef.current = null;
      pendingDragItemRef.current = null;
      dragStartLayoutRef.current = null;
      lastDragPreviewRef.current = null;
      setWorkingLayout(finalLayout as Layout);
    },
    [widgets, dynamicCols],
  );


  function handleTemplateDragStart(event: DragEvent<HTMLElement>, definition: WidgetDefinition) {
    draggingTemplateRef.current = definition;
    pendingTemplateRef.current = { definition, expiresAt: Date.now() + 5000 };
    setDragCanvasHeightPx(canvasHeightPxRef.current + 500);
    setDraggingTemplateId(definition.id);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/aifom-widget", definition.id);
    event.dataTransfer.setData("text/plain", definition.id);
    // Firefox requires non-empty drag data; the actual template is tracked in React state.
  }

  function handleTemplateDragEnd() {
    // Do not clear pendingTemplateRef here: dragend may fire before drop.
    draggingTemplateRef.current = null;
    setDraggingTemplateId(null);
    setDragCanvasHeightPx(null);
  }

  const isWidgetDragEvent = useCallback((dataTransfer?: DataTransfer | null) => {
    if (draggingTemplateRef.current) return true;
    if (pendingTemplateRef.current && pendingTemplateRef.current.expiresAt > Date.now()) return true;
    if (!dataTransfer || !dataTransfer.types) return false;
    const types = Array.from(dataTransfer.types);
    return types.includes("application/aifom-widget") || types.includes("text/plain");
  }, []);

  const resolveDraggedTemplate = useCallback((dataTransfer?: DataTransfer | null) => {
    if (draggingTemplateRef.current) return draggingTemplateRef.current;
    if (!dataTransfer) return null;

    const widgetType =
      dataTransfer.getData("application/aifom-widget") ||
      dataTransfer.getData("text/plain");
    if (!widgetType) {
      const pending = pendingTemplateRef.current;
      return pending && pending.expiresAt > Date.now() ? pending.definition : null;
    }

    return listWidgetDefinitions("", true).find((definition) => definition.id === widgetType) ?? null;
  }, []);

  const clearDraggedTemplate = useCallback(() => {
    draggingTemplateRef.current = null;
    pendingTemplateRef.current = null;
    setDraggingTemplateId(null);
    setDragCanvasHeightPx(null);
  }, []);

  const handleTemplateDoubleClick = useCallback(
    (definition: WidgetDefinition) => {
      const constraints = getWidgetSizeConstraints(definition.id);
      let dropped: GridLayoutData = {
        x: 0,
        y: 0,
        w: constraints.defaultW,
        h: constraints.defaultH,
        minW: constraints.minW,
        minH: constraints.minH,
      };

      // Find first empty cell (from top-left, top-to-bottom, left-to-right)
      let found = false;
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x <= dynamicCols - dropped.w; x++) {
          const candidate = { ...dropped, x, y };
          if (!(renderedLayout as LayoutItem[]).some((item) => itemsCollide(candidate, item))) {
            dropped = candidate;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      onDropTemplate(definition.id, dropped);
    },
    [dynamicCols, onDropTemplate, renderedLayout],
  );

  const handleGridLibraryDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const definition = resolveDraggedTemplate(event.dataTransfer);
      if (!definition) return;
      event.preventDefault();
      event.stopPropagation();

      const constraints = getWidgetSizeConstraints(definition.id);
      const rect = event.currentTarget.getBoundingClientRect();
      const paddingX = GRID_CONTAINER_PADDING[0];
      const paddingY = GRID_CONTAINER_PADDING[1];
      const availableWidth = Math.max(1, rect.width - paddingX * 2);
      const columnWidth = availableWidth / dynamicCols;
      const rawX = Math.floor((event.clientX - rect.left - paddingX) / columnWidth);
      const rawY = Math.floor((event.clientY - rect.top - paddingY) / (GRID_ROW_HEIGHT + GRID_MARGIN[1]));
      let dropped: GridLayoutData = {
        x: Math.max(0, Math.min(dynamicCols - constraints.defaultW, rawX)),
        y: Math.max(0, rawY),
        w: constraints.defaultW,
        h: constraints.defaultH,
        minW: constraints.minW,
        minH: constraints.minH,
      };

      // Tim o trong gan vi tri tha nhat; khong day widget cu de tranh layout nhay bat ngo.
      while ((renderedLayout as LayoutItem[]).some((item) => itemsCollide(dropped, item))) {
        dropped = { ...dropped, y: dropped.y + 1 };
      }

      onDropTemplate(definition.id, dropped);
      clearDraggedTemplate();
    },
    [clearDraggedTemplate, dynamicCols, onDropTemplate, renderedLayout, resolveDraggedTemplate],
  );

  const handleGridDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isEditing) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [isEditing]);

  const handleDrop = useCallback(
    (_layout: Layout, item: LayoutItem | undefined, event?: globalThis.DragEvent) => {
      const definition = resolveDraggedTemplate(event?.dataTransfer);
      if (!definition || !item) return;
      onDropTemplate(definition.id, buildDropLayout(definition, item));
      clearDraggedTemplate();
    },
    [clearDraggedTemplate, onDropTemplate, resolveDraggedTemplate],
  );

  const showOverlay = isDragging || !!draggingTemplateId;

  const gridClassName = cn(
    "dashboard-grid",
    isEditing && "dashboard-grid--editing",
    showOverlay && "dashboard-grid--dragging",
  );

  const droppingDefinition = draggingTemplateRef.current;
  const droppingConstraints = droppingDefinition ? getWidgetSizeConstraints(droppingDefinition.id) : null;
  const canPersistLayout = hasChanges || widgets.some((widget) => !widget.layout?.grid);
  // Canvas cần chiếm phần lớn viewport để thao tác kéo thả không bị bó trong khung thấp.
  const builderMinHeight = isEditing ? "max(620px, calc(100vh - 12rem))" : "max(520px, calc(100vh - 14rem))";
  const maxItemY = useMemo(() => {
    let maxY = 0;
    for (const item of renderedLayout as LayoutItem[]) {
      maxY = Math.max(maxY, item.y + item.h);
    }
    return maxY;
  }, [renderedLayout]);

  const canvasHeightPx = maxItemY * (GRID_ROW_HEIGHT + GRID_MARGIN[1]) + GRID_CONTAINER_PADDING[1] * 2;
  canvasHeightPxRef.current = canvasHeightPx;
  // Chỉ giữ lại một khoảng đệm nhỏ dưới widget cuối cùng. Khi layout vượt
  // chiều cao tối thiểu của viewport, canvas sẽ tự tăng theo maxItemY.
  // Trong lúc kéo, giữ nguyên chiều cao đã chụp ở drag start để tránh vừa
  // xử lý collision vừa thay đổi chiều cao canvas trên từng frame.
  const layoutCanvasHeightPx = showOverlay && dragCanvasHeightPx !== null
    ? dragCanvasHeightPx
    : canvasHeightPx + GRID_MARGIN[1];
  const canvasMinHeight = isEditing
    ? `max(${layoutCanvasHeightPx}px, 580px, calc(100vh - 14rem))`
    : `max(${layoutCanvasHeightPx}px, 480px, calc(100vh - 16rem))`;

  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-slate-100/70 shadow-sm dark:border-border-subtle dark:bg-app/60">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-white/80 px-4 py-4 backdrop-blur dark:border-border-subtle dark:bg-topbar/90 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-300">
            <LayoutDashboard className="h-3.5 w-3.5" />
            {t("dashboard:palette.project_builder", "Project builder")}
            <span className="rounded-full border border-brand-200 px-2 py-0.5 text-[10px] normal-case tracking-normal text-brand-700 dark:border-brand-900 dark:text-brand-300">
              {t("dashboard:palette.grid_info", "{{cols}} columns · {{rows}}px rows", { cols: dynamicCols, rows: GRID_ROW_HEIGHT })}
            </span>
          </div>
          {/* <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-text-primary">{projectName}</h2> */}
          <p className="mt-1 text-xs text-slate-500">
            {isEditing
              ? t("dashboard:palette.hint_editing", "Kéo widget từ thư viện vào canvas, sau đó cấu hình và lưu layout.")
              : t("dashboard:palette.hint_preview", "Preview mode: dashboard bị khóa layout, control widget hoạt động bình thường.")}
          </p>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {!isEditing && !isPreviewMode && (
              <button className="btn-primary inline-flex items-center gap-1.5 text-xs" onClick={enterEditMode}>
                <LayoutDashboard className="h-3.5 w-3.5" />
                {t("dashboard:palette.btn_edit_dashboard", "Edit dashboard")}
              </button>
            )}

            {isEditing && (
              <>
                <button className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={enterPreviewMode}>
                  <Eye className="h-3.5 w-3.5" />
                  {t("dashboard:palette.btn_preview", "Preview")}
                </button>
                <button className="btn-primary inline-flex items-center gap-1.5 text-xs" onClick={saveLayout} disabled={!canPersistLayout || isSaving}>
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? t("dashboard:palette.btn_saving", "Saving...") : t("dashboard:palette.btn_save_layout", "Save layout")}
                </button>
                <button className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={cancelEdit}>
                  <X className="h-3.5 w-3.5" />
                  {t("dashboard:palette.btn_cancel", "Cancel changes")}
                </button>
                <button className="btn-ghost inline-flex items-center gap-1.5 text-xs" onClick={resetLayout}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("dashboard:palette.btn_reset", "Reset layout")}
                </button>
                <button className="btn-ghost inline-flex items-center gap-1.5 text-xs lg:hidden" onClick={() => setPaletteOpen((v) => !v)}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("dashboard:palette.btn_widgets", "Widgets")}
                </button>
              </>
            )}

            {isPreviewMode && (
              <>
                <div className="mr-2 flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse-dot" />
                  {t("dashboard:palette.previewing_unsaved", "Previewing unsaved layout")}
                </div>
                <button className="btn-primary inline-flex items-center gap-1.5 text-xs" onClick={saveLayout} disabled={!canPersistLayout || isSaving}>
                  <Save className="h-3.5 w-3.5" />
                  {isSaving ? t("dashboard:palette.btn_saving", "Saving...") : t("dashboard:palette.btn_save_layout", "Save layout")}
                </button>
                <button className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={backToDesign}>
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  {t("dashboard:palette.btn_back_to_design", "Back to design")}
                </button>
                <button className="btn-ghost inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400" onClick={cancelEdit}>
                  <X className="h-3.5 w-3.5" />
                  {t("dashboard:palette.btn_cancel", "Cancel changes")}
                </button>
              </>
            )}

            {hasChanges && isEditing && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse-dot" />
                {t("dashboard:palette.unsaved_layout", "Unsaved layout")}
              </span>
            )}
          </div>
        )}
      </div>

      <div
        className={cn("grid grid-cols-1", isEditing && !readOnly && "xl:grid-cols-[320px_minmax(0,1fr)]")}
        style={{ minHeight: builderMinHeight }}
      >
        {isEditing && !readOnly && (
          <aside
            className={cn(
              "border-b border-slate-200 bg-white/92 p-4 dark:border-border-subtle dark:bg-app/90 xl:block xl:border-b-0 xl:border-r",
              !paletteOpen && "hidden xl:block",
            )}
          >
            <div className="sticky top-20 space-y-4">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-9"
                  value={paletteSearch}
                  onChange={(event) => setPaletteSearch(event.target.value)}
                  placeholder={t("dashboard:palette.search_placeholder", "Search widgets...")}
                />
              </label>

              <div className="max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto pr-1">
                {(Object.keys(GROUP_LABELS_KEYS) as PaletteGroup[]).map((group) => {
                  const items = groupedDefinitions[group];
                  if (items.length === 0) return null;
                  return (
                    <div key={group}>
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{t(GROUP_LABELS_KEYS[group])}</p>
                      <div className="space-y-2">
                        {items.map((definition) => {
                          const Icon = definition.icon;
                          const selected = draggingTemplateId === definition.id;
                          return (
                            <div
                              key={definition.id}
                              draggable
                              onDragStart={(event) => handleTemplateDragStart(event, definition)}
                              onDragEnd={handleTemplateDragEnd}
                              className={cn(
                                "w-full rounded-2xl border p-3 text-left transition active:cursor-grabbing",
                                selected
                                  ? "border-brand-400 bg-brand-50 shadow-sm dark:border-brand-500/60 dark:bg-brand-950/30"
                                  : "border-slate-200 bg-slate-50 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-white hover:shadow-sm dark:border-border-subtle dark:bg-surface/70 dark:hover:border-brand-700 dark:hover:bg-surface-elevated",
                              )}
                            >
                              <span className="flex items-start gap-3">
                                <span className="rounded-xl bg-white p-2 text-brand-600 shadow-sm dark:bg-app dark:text-brand-300">
                                  <Icon className="h-4 w-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-sm font-bold text-slate-900 dark:text-text-primary">{t(`projects:widget_registry.${definition.id}.label`, definition.label)}</span>
                                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500">{t(`projects:widget_registry.${definition.id}.description`, definition.description ?? "")}</span>
                                </span>
                              </span>
                              <button
                                type="button"
                                className="btn-secondary mt-3 min-h-9 w-full text-xs"
                                onClick={() => handleTemplateDoubleClick(definition)}
                              >
                                {t("dashboard:palette.btn_add_widget", "+ Add")}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        <div className="min-w-0 p-3 sm:p-4">
          <div
            ref={containerRef as React.RefObject<HTMLDivElement>}
            onDragOver={handleGridDragOver}
            onDrop={handleGridLibraryDrop}
            className={cn(
              "relative overflow-visible rounded-[1.4rem] border bg-white shadow-inner dark:bg-app",
              isEditing ? "border-brand-200 dark:border-brand-900" : "border-slate-200 dark:border-border-subtle",
            )}
            style={{ minHeight: canvasMinHeight }}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.13] dark:opacity-[0.08]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgb(51 102 255 / 0.42) 1px, transparent 1px), linear-gradient(to bottom, rgb(51 102 255 / 0.34) 1px, transparent 1px)",
                backgroundSize: `${100 / dynamicCols}% ${GRID_ROW_HEIGHT + GRID_MARGIN[1]}px`,
              }}
            />
            {widgets.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
                <div className="max-w-md rounded-[1.4rem] border border-dashed border-brand-300 bg-white/90 p-8 shadow-sm backdrop-blur dark:border-brand-800 dark:bg-app/85">
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-brand-500" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-text-primary">{t("dashboard:palette.empty_canvas_title", "Kéo widget từ thanh bên vào đây để thiết kế dashboard.")}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{t("dashboard:palette.empty_canvas_hint", "Widget sẽ snap vào lưới và được cấu hình trước khi lưu vào project.")}</p>
                </div>
              </div>
            )}

            {mounted && (containerWidth > 150 || import.meta.env.MODE === "test") && (
              <DragPerformanceProvider value={isDragging}>
              <ResponsiveGridLayout
                key={`${isEditing}-${dynamicCols}`}
                className={gridClassName}
                width={containerWidth}
                layouts={{
                  lg: renderedLayout.map((item) => ({ ...item })),
                  xs: renderedLayout.map((item) => ({ ...item })),
                  xxs: renderedLayout.map((item) => ({ ...item }))
                }}
                breakpoints={{ lg: 768, xs: 480, xxs: 0 }}
                cols={{ lg: dynamicCols, xs: 12, xxs: 6 }}
                rowHeight={GRID_ROW_HEIGHT}
                margin={GRID_MARGIN}
                containerPadding={GRID_CONTAINER_PADDING}
                isBounded={false}
                dragConfig={{
                  enabled: isEditing,
                  handle: ".dashboard-grid-drag-handle",
                  cancel: ".dashboard-grid-action",
                  threshold: 3,
                  bounded: false,
                }}
                resizeConfig={{ enabled: isEditing, handles: ["se"] }}
                dropConfig={{ enabled: false, defaultItem: { w: droppingConstraints?.defaultW ?? 4, h: droppingConstraints?.defaultH ?? 2 } }}
                droppingItem={
                  droppingConstraints
                    ? ({ i: "__dropping-elem__", x: 0, y: 0, w: droppingConstraints.defaultW, h: droppingConstraints.defaultH } as LayoutItem)
                    : undefined
                }
                compactType={null}
                compactor={customCompactor}
                preventCollision={false}
                onLayoutChange={handleLayoutChange}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDragStop={handleDragStop}
                onResizeStart={handleDragStart}
                onResize={handleDrag}
                onResizeStop={handleDragStop}
                onDrop={handleDrop}
              >
                {widgets.map((widget) => (
                  <div key={widget.id} className="dashboard-grid-item">
                    {isEditing && (
                      <div className="dashboard-grid-drag-handle" title={t("dashboard:palette.drag_widget", "Drag widget")}>
                        <GripVertical className="h-4 w-4" />
                      </div>
                    )}
                    {isEditing && showOverlay && <div className="dashboard-grid-overlay" />}
                    {renderWidget(widget, isEditing)}
                  </div>
                ))}
              </ResponsiveGridLayout>
              </DragPerformanceProvider>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
