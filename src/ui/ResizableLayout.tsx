import {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useRef
} from "react";

export type ResizableLayoutId =
  | "app-sidebar"
  | "sidebar-workspaces"
  | "extraction"
  | "generation"
  | "image-edit";

type LayoutRatios = Partial<Record<ResizableLayoutId, number>>;
type LayoutStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type LayoutPreferences = {
  version: 1;
  ratios: LayoutRatios;
};

export type LayoutRatioBounds = {
  min: number;
  max: number;
};

export const LAYOUT_PREFERENCES_STORAGE_KEY =
  "image-style-prompt-extractor:resizable-layout:v1";
export const LAYOUT_PREFERENCES_RESET_EVENT = "image-style-layout-preferences-reset";

const layoutIds: ResizableLayoutId[] = [
  "app-sidebar",
  "sidebar-workspaces",
  "extraction",
  "generation",
  "image-edit"
];
const minimumStoredRatio = 0.05;
const maximumStoredRatio = 0.95;

const emptyLayoutPreferences = (): LayoutPreferences => ({
  version: 1,
  ratios: {}
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseLayoutPreferences = (value: unknown): LayoutPreferences => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.ratios)) {
    return emptyLayoutPreferences();
  }

  const ratios: LayoutRatios = {};
  for (const layoutId of layoutIds) {
    const ratio = value.ratios[layoutId];
    if (
      typeof ratio === "number" &&
      Number.isFinite(ratio) &&
      ratio >= minimumStoredRatio &&
      ratio <= maximumStoredRatio
    ) {
      ratios[layoutId] = ratio;
    }
  }
  return { version: 1, ratios };
};

const readLayoutPreferences = (
  storage: LayoutStorage = window.localStorage
): LayoutPreferences => {
  try {
    const stored = storage.getItem(LAYOUT_PREFERENCES_STORAGE_KEY);
    return stored ? parseLayoutPreferences(JSON.parse(stored)) : emptyLayoutPreferences();
  } catch {
    return emptyLayoutPreferences();
  }
};

const writeLayoutPreferences = (
  preferences: LayoutPreferences,
  storage: LayoutStorage = window.localStorage
): void => {
  try {
    if (Object.keys(preferences.ratios).length === 0) {
      storage.removeItem(LAYOUT_PREFERENCES_STORAGE_KEY);
      return;
    }
    storage.setItem(LAYOUT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Resizing remains available for the current session when storage is unavailable.
  }
};

const saveLayoutRatio = (layoutId: ResizableLayoutId, ratio: number): void => {
  const preferences = readLayoutPreferences();
  preferences.ratios[layoutId] = ratio;
  writeLayoutPreferences(preferences);
};

const removeLayoutRatio = (layoutId: ResizableLayoutId): void => {
  const preferences = readLayoutPreferences();
  delete preferences.ratios[layoutId];
  writeLayoutPreferences(preferences);
};

export const clearLayoutPreferences = (
  storage: LayoutStorage = window.localStorage
): void => {
  try {
    storage.removeItem(LAYOUT_PREFERENCES_STORAGE_KEY);
  } catch {
    // Mounted separators still reset to defaults below.
  }
  window.dispatchEvent(new Event(LAYOUT_PREFERENCES_RESET_EVENT));
};

export const defaultLayoutRatio = (
  layoutId: ResizableLayoutId,
  containerSize: number
): number => {
  const size = Math.max(containerSize, 1);
  if (layoutId === "sidebar-workspaces") {
    const workspaceNavigationHeight = size <= 759 ? 208 : 240;
    return workspaceNavigationHeight / size;
  }
  if (layoutId === "app-sidebar") {
    const sidebarWidth =
      size >= 1440 ? 260 : size >= 1280 ? 248 : size >= 1180 ? 238 : 216;
    return sidebarWidth / size;
  }
  if (layoutId === "extraction") {
    const inputPanelWidth = size >= 1120 ? 370 : size <= 880 ? 310 : 340;
    return inputPanelWidth / size;
  }
  return layoutId === "generation" ? 0.46 : 0.5;
};

export const resolveLayoutRatioBounds = (
  containerSize: number,
  minimumStartSize: number,
  minimumEndSize: number,
  separatorSize = 10,
  maximumStartSize = Number.POSITIVE_INFINITY
): LayoutRatioBounds => {
  if (!Number.isFinite(containerSize) || containerSize <= 0) {
    return { min: minimumStoredRatio, max: maximumStoredRatio };
  }

  const availableSize = Math.max(0, containerSize - Math.max(0, separatorSize));
  const min = Math.max(0, minimumStartSize) / containerSize;
  const max = Math.min(
    (availableSize - Math.max(0, minimumEndSize)) / containerSize,
    Number.isFinite(maximumStartSize)
      ? Math.max(0, maximumStartSize) / containerSize
      : maximumStoredRatio
  );
  if (min <= max) {
    return {
      min: Math.max(minimumStoredRatio, min),
      max: Math.min(maximumStoredRatio, max)
    };
  }

  const requestedSize = Math.max(1, minimumStartSize + minimumEndSize);
  const sharedRatio =
    (availableSize * (Math.max(0, minimumStartSize) / requestedSize)) /
    containerSize;
  const clampedSharedRatio = Math.min(
    maximumStoredRatio,
    Math.max(minimumStoredRatio, sharedRatio)
  );
  return { min: clampedSharedRatio, max: clampedSharedRatio };
};

export const clampLayoutRatio = (
  ratio: number,
  bounds: LayoutRatioBounds
): number => Math.min(bounds.max, Math.max(bounds.min, ratio));

type ResizableSeparatorProps = {
  className?: string;
  cssVariable: `--${string}`;
  label: string;
  layoutId: ResizableLayoutId;
  maximumStartSize?: LayoutSizeConstraint;
  minimumEndSize: LayoutSizeConstraint;
  minimumStartSize: LayoutSizeConstraint;
  orientation?: "horizontal" | "vertical";
};

type LayoutSizeConstraint = number | ((containerSize: number) => number);

const resolveSizeConstraint = (
  constraint: LayoutSizeConstraint | undefined,
  containerSize: number,
  fallback: number
): number => {
  if (constraint === undefined) return fallback;
  return typeof constraint === "function" ? constraint(containerSize) : constraint;
};

export function ResizableSeparator({
  className = "",
  cssVariable,
  label,
  layoutId,
  maximumStartSize,
  minimumEndSize,
  minimumStartSize,
  orientation = "vertical"
}: ResizableSeparatorProps): JSX.Element {
  const separatorRef = useRef<HTMLDivElement | null>(null);
  const parentRef = useRef<HTMLElement | null>(null);
  const preferredRatioRef = useRef(
    defaultLayoutRatio(
      layoutId,
      orientation === "horizontal" ? window.innerHeight : window.innerWidth
    )
  );
  const effectiveRatioRef = useRef(preferredRatioRef.current);
  const useResponsiveDefaultRef = useRef(true);
  const animationFrameRef = useRef<number | null>(null);
  const pendingRatioRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const getContainerSize = useCallback(() => {
    const rect = parentRef.current?.getBoundingClientRect();
    return rect ? (orientation === "horizontal" ? rect.height : rect.width) : 0;
  }, [orientation]);

  const getBounds = useCallback((): LayoutRatioBounds => {
    const containerSize = getContainerSize();
    const separatorRect = separatorRef.current?.getBoundingClientRect();
    const separatorSize = separatorRect
      ? orientation === "horizontal"
        ? separatorRect.height
        : separatorRect.width
      : 10;
    return resolveLayoutRatioBounds(
      containerSize,
      resolveSizeConstraint(minimumStartSize, containerSize, 0),
      resolveSizeConstraint(minimumEndSize, containerSize, 0),
      separatorSize,
      resolveSizeConstraint(
        maximumStartSize,
        containerSize,
        Number.POSITIVE_INFINITY
      )
    );
  }, [
    getContainerSize,
    maximumStartSize,
    minimumEndSize,
    minimumStartSize,
    orientation
  ]);

  const applyRatio = useCallback(
    (requestedRatio: number): number => {
      const parent = parentRef.current;
      const separator = separatorRef.current;
      if (!parent || !separator) return requestedRatio;

      const bounds = getBounds();
      const ratio = clampLayoutRatio(requestedRatio, bounds);
      effectiveRatioRef.current = ratio;
      parent.style.setProperty(
        cssVariable,
        orientation === "horizontal"
          ? `${ratio * getContainerSize()}px`
          : `${ratio * 100}%`
      );
      separator.setAttribute("aria-valuemin", String(Math.round(bounds.min * 100)));
      separator.setAttribute("aria-valuemax", String(Math.round(bounds.max * 100)));
      separator.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
      separator.setAttribute(
        "aria-valuetext",
        `${orientation === "horizontal" ? "上方" : "左侧"}区域占 ${Math.round(ratio * 100)}%`
      );
      return ratio;
    },
    [cssVariable, getBounds, getContainerSize, orientation]
  );

  const applyPreferredRatio = useCallback(() => {
    const containerSize = getContainerSize();
    if (useResponsiveDefaultRef.current) {
      preferredRatioRef.current = defaultLayoutRatio(layoutId, containerSize);
    }
    applyRatio(preferredRatioRef.current);
  }, [applyRatio, getContainerSize, layoutId]);

  const flushPendingRatio = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (pendingRatioRef.current === null) return;
    const ratio = pendingRatioRef.current;
    pendingRatioRef.current = null;
    applyRatio(ratio);
  }, [applyRatio]);

  const queueRatio = useCallback(
    (ratio: number) => {
      pendingRatioRef.current = ratio;
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        if (pendingRatioRef.current === null) return;
        const nextRatio = pendingRatioRef.current;
        pendingRatioRef.current = null;
        applyRatio(nextRatio);
      });
    },
    [applyRatio]
  );

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    flushPendingRatio();
    draggingRef.current = false;
    document.body.classList.remove(
      "layout-resizing",
      "layout-resizing-horizontal",
      "layout-resizing-vertical"
    );

    const separator = separatorRef.current;
    const pointerId = activePointerIdRef.current;
    activePointerIdRef.current = null;
    if (separator) delete separator.dataset.resizing;
    if (separator && pointerId !== null && separator.hasPointerCapture(pointerId)) {
      separator.releasePointerCapture(pointerId);
    }

    preferredRatioRef.current = effectiveRatioRef.current;
    saveLayoutRatio(layoutId, preferredRatioRef.current);
  }, [flushPendingRatio, layoutId]);

  useLayoutEffect(() => {
    const separator = separatorRef.current;
    const parent = separator?.parentElement;
    if (!separator || !parent) return;
    parentRef.current = parent;

    const storedRatio = readLayoutPreferences().ratios[layoutId];
    useResponsiveDefaultRef.current = storedRatio === undefined;
    const parentRect = parent.getBoundingClientRect();
    const containerSize = orientation === "horizontal" ? parentRect.height : parentRect.width;
    preferredRatioRef.current =
      storedRatio ?? defaultLayoutRatio(layoutId, containerSize);
    applyPreferredRatio();

    const resizeObserver = new ResizeObserver(applyPreferredRatio);
    resizeObserver.observe(parent);
    const resetToDefault = () => {
      useResponsiveDefaultRef.current = true;
      applyPreferredRatio();
    };
    const finishOnBlur = () => finishDrag();
    window.addEventListener(LAYOUT_PREFERENCES_RESET_EVENT, resetToDefault);
    window.addEventListener("blur", finishOnBlur);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener(LAYOUT_PREFERENCES_RESET_EVENT, resetToDefault);
      window.removeEventListener("blur", finishOnBlur);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      document.body.classList.remove(
        "layout-resizing",
        "layout-resizing-horizontal",
        "layout-resizing-vertical"
      );
      delete separator.dataset.resizing;
      parent.style.removeProperty(cssVariable);
      parentRef.current = null;
    };
  }, [applyPreferredRatio, cssVariable, finishDrag, layoutId, orientation]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    useResponsiveDefaultRef.current = false;
    preferredRatioRef.current = effectiveRatioRef.current;
    draggingRef.current = true;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.dataset.resizing = "true";
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add(
      "layout-resizing",
      orientation === "horizontal"
        ? "layout-resizing-horizontal"
        : "layout-resizing-vertical"
    );
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || event.pointerId !== activePointerIdRef.current) return;
    const parent = parentRef.current;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const containerSize = orientation === "horizontal" ? rect.height : rect.width;
    if (containerSize <= 0) return;
    const pointerOffset =
      orientation === "horizontal"
        ? event.clientY - rect.top
        : event.clientX - rect.left;
    queueRatio(pointerOffset / containerSize);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decreaseKey = orientation === "horizontal" ? "ArrowUp" : "ArrowLeft";
    const increaseKey = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
    if (event.key !== decreaseKey && event.key !== increaseKey) return;
    event.preventDefault();
    useResponsiveDefaultRef.current = false;
    const direction = event.key === decreaseKey ? -1 : 1;
    const step = event.shiftKey ? 0.05 : 0.01;
    const ratio = applyRatio(effectiveRatioRef.current + direction * step);
    preferredRatioRef.current = ratio;
    saveLayoutRatio(layoutId, ratio);
  };

  const onDoubleClick = () => {
    useResponsiveDefaultRef.current = true;
    removeLayoutRatio(layoutId);
    applyPreferredRatio();
  };

  const initialRatio = preferredRatioRef.current;
  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={Math.round(maximumStoredRatio * 100)}
      aria-valuemin={Math.round(minimumStoredRatio * 100)}
      aria-valuenow={Math.round(initialRatio * 100)}
      aria-valuetext={`${orientation === "horizontal" ? "上方" : "左侧"}区域占 ${Math.round(initialRatio * 100)}%`}
      className={`layout-separator layout-separator-${orientation} ${className}`.trim()}
      data-layout-id={layoutId}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onLostPointerCapture={finishDrag}
      onPointerCancel={finishDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      ref={separatorRef}
      role="separator"
      tabIndex={0}
    />
  );
}
