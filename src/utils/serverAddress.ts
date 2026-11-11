/** Public address of a game server: <panel domain>:<port> (falls back to the host the panel is opened on). */
export function serverHost(panelDomain?: string): string {
  return panelDomain && panelDomain.trim() ? panelDomain.trim() : window.location.hostname;
}

export function serverAddress(panelDomain: string | undefined, port: number | string | undefined): string {
  const p = port ? String(port) : "25565";
  return `${serverHost(panelDomain)}:${p}`;
}

/** Address players use: the playit / Cloudflare address of the node when there is one, otherwise <host>:<port>. */
export function serverAddressOf(server: any, panelDomain?: string): string {
  if (server?.publicHost && server?.publicPort) return `${server.publicHost}:${server.publicPort}`;
  return serverAddress(server?.host || panelDomain, server?.port);
}
