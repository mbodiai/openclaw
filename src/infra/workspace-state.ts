import fs from "node:fs/promises";

/**
 * Workspace state viewer utility.
 * Added to verify automated Docker build triggers.
 */
export async function getWorkspaceSummary(
  workspaceDir: string,
): Promise<{ status: string; count?: number; error?: string }> {
  try {
    const entries = await fs.readdir(workspaceDir);
    return { status: "ok", count: entries.length };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}
