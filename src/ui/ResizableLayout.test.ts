import { describe, expect, it } from "vitest";
import {
  clampLayoutRatio,
  defaultLayoutRatio,
  parseLayoutPreferences,
  resolveLayoutRatioBounds
} from "./ResizableLayout";

describe("resizable layout preferences", () => {
  it("keeps only finite, versioned ratios within the supported range", () => {
    expect(
      parseLayoutPreferences({
        version: 1,
        ratios: {
          "app-sidebar": 0.22,
          "sidebar-workspaces": 0.28,
          extraction: Number.NaN,
          generation: 1.2,
          "image-edit": "0.5"
        }
      })
    ).toEqual({
      version: 1,
      ratios: { "app-sidebar": 0.22, "sidebar-workspaces": 0.28 }
    });
    expect(parseLayoutPreferences({ version: 2, ratios: { generation: 0.5 } })).toEqual({
      version: 1,
      ratios: {}
    });
  });

  it("derives dynamic bounds from both adjacent minimum widths", () => {
    const bounds = resolveLayoutRatioBounds(1080, 200, 720, 10);
    expect(bounds.min).toBeCloseTo(200 / 1080);
    expect(bounds.max).toBeCloseTo((1080 - 10 - 720) / 1080);
    expect(clampLayoutRatio(0.05, bounds)).toBe(bounds.min);
    expect(clampLayoutRatio(0.8, bounds)).toBe(bounds.max);
    expect(resolveLayoutRatioBounds(1320, 200, 720, 10, 360).max).toBeCloseTo(
      360 / 1320
    );
  });

  it("uses a stable proportional fallback when both minimums cannot fit", () => {
    const bounds = resolveLayoutRatioBounds(600, 400, 360, 10);
    expect(bounds.min).toBe(bounds.max);
    expect(bounds.min).toBeGreaterThan(0);
    expect(bounds.max).toBeLessThan(1);
  });

  it("matches the Liquid Pro responsive defaults before a user preference exists", () => {
    expect(defaultLayoutRatio("app-sidebar", 1440) * 1440).toBeCloseTo(260);
    expect(defaultLayoutRatio("app-sidebar", 1320) * 1320).toBeCloseTo(248);
    expect(defaultLayoutRatio("app-sidebar", 1080) * 1080).toBeCloseTo(216);
    expect(defaultLayoutRatio("sidebar-workspaces", 860) * 860).toBeCloseTo(240);
    expect(defaultLayoutRatio("sidebar-workspaces", 720) * 720).toBeCloseTo(208);
    expect(defaultLayoutRatio("extraction", 840) * 840).toBeCloseTo(310);
    expect(defaultLayoutRatio("generation", 1200)).toBe(0.46);
    expect(defaultLayoutRatio("image-edit", 1200)).toBe(0.5);
  });
});
