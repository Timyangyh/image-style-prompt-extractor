import type { Session } from "electron";

type SessionCleanupTarget = Pick<
  Session,
  "clearAuthCache" | "clearCodeCaches" | "clearData" | "clearHostResolverCache" | "closeAllConnections"
>;

export const clearWindowsSessionData = async (
  target: SessionCleanupTarget,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> => {
  if (platform !== "win32") return false;

  await target.closeAllConnections();
  await target.clearData();
  await Promise.all([target.clearAuthCache(), target.clearHostResolverCache(), target.clearCodeCaches({})]);
  return true;
};
