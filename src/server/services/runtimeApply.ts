import { createServerRuntime, deleteServerRuntime, getServerRuntimeStatus } from "./runtime.js";

/** True if the server process/container is currently running. */
export async function isServerRunning(server: any): Promise<boolean> {
  try {
    const st = await getServerRuntimeStatus(server);
    return !!st?.State?.Running;
  } catch {
    return false;
  }
}

/**
 * Docker only bakes env vars, ports and image into the container at creation time.
 * After changing them the container is recreated (data lives in the bind-mounted server folder, so nothing is lost).
 * Mutates `server.containerId`. Local runtime needs nothing.
 */
export async function recreateRuntime(server: any): Promise<boolean> {
  if (server.runtimeType === "local" || !server.containerId) return false;
  try { await deleteServerRuntime(server); } catch {}
  server.containerId = await createServerRuntime(server);
  return true;
}
