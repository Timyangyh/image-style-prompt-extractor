import { describe, expect, it, vi } from "vitest";
import { clearWindowsSessionData } from "./session-cleanup";

const cleanupTarget = () => ({
  clearAuthCache: vi.fn(async () => undefined),
  clearCodeCaches: vi.fn(async () => undefined),
  clearData: vi.fn(async () => undefined),
  clearHostResolverCache: vi.fn(async () => undefined),
  closeAllConnections: vi.fn(async () => undefined)
});

describe("Windows Electron session cleanup", () => {
  it("clears connections, browsing data and runtime caches on Windows", async () => {
    const target = cleanupTarget();
    await expect(clearWindowsSessionData(target, "win32")).resolves.toBe(true);
    expect(target.closeAllConnections).toHaveBeenCalledOnce();
    expect(target.clearData).toHaveBeenCalledOnce();
    expect(target.clearAuthCache).toHaveBeenCalledOnce();
    expect(target.clearHostResolverCache).toHaveBeenCalledOnce();
    expect(target.clearCodeCaches).toHaveBeenCalledWith({});
    expect(target.closeAllConnections.mock.invocationCallOrder[0]).toBeLessThan(
      target.clearData.mock.invocationCallOrder[0]
    );
  });

  it("does not change the existing macOS cleanup behavior", async () => {
    const target = cleanupTarget();
    await expect(clearWindowsSessionData(target, "darwin")).resolves.toBe(false);
    Object.values(target).forEach((method) => expect(method).not.toHaveBeenCalled());
  });
});
