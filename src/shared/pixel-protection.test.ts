import { describe, expect, it } from "vitest";
import { composePixelProtectedRgba } from "./pixel-protection";

describe("composePixelProtectedRgba", () => {
  const source = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255
  ]);
  const model = new Uint8ClampedArray([
    200, 210, 220, 255,
    70, 80, 90, 255
  ]);

  it("keeps source pixels when mask alpha is fully opaque", () => {
    const mask = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255
    ]);
    expect(Array.from(composePixelProtectedRgba(source, model, mask))).toEqual(Array.from(source));
  });

  it("uses model output pixels when mask alpha is fully transparent", () => {
    const mask = new Uint8ClampedArray([
      255, 255, 255, 0,
      255, 255, 255, 0
    ]);
    expect(Array.from(composePixelProtectedRgba(source, model, mask))).toEqual(Array.from(model));
  });

  it("blends only partial-alpha boundary pixels", () => {
    const mask = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 128
    ]);
    expect(Array.from(composePixelProtectedRgba(source, model, mask))).toEqual([
      10, 20, 30, 255,
      55, 65, 75, 255
    ]);
  });
});
