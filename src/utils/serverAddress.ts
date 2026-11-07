/** Public address of a game server: <panel domain>:<port> (falls back to the host the panel is opened on). */
export function serverHost(panelDomain?: string): string {
  return panelDomain && panelDomain.trim() ? panelDomain.trim() : window.location.hostname;
}

export function serverAddress(panelDomain: string | undefined, port: number | string | undefined): string {
  const p = port ? String(port) : "25565";
  return `${serverHost(panelDomain)}:${p}`;
}
