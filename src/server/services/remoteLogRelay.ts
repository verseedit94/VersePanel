import { io as ioClient, Socket } from "socket.io-client";
import { AgentNode, nodeBaseUrl, nodeTokenOf } from "./nodeClient.js";
import { encodeActingUser } from "./nodeMode.js";

/**
 * Live console for servers on a Verse Node: the main panel opens ONE socket.io connection per server to the node
 * and forwards its "log" events into the panel's own room (server_<id>), so browsers keep talking only to the panel.
 */
const relays = new Map<string, Socket>();

export function startRelay(mainIo: any, serverId: string, node: AgentNode) {
  if (relays.has(serverId)) return;
  const socket = ioClient(nodeBaseUrl(node), {
    auth: { nodeToken: nodeTokenOf(node), acting: encodeActingUser(undefined) },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: 30
  });
  socket.on("connect", () => socket.emit("joinServer", serverId));
  socket.on("log", (data: string) => mainIo.to(`server_${serverId}`).emit("log", data));
  socket.on("connect_error", (e: Error) => {
    mainIo.to(`server_${serverId}`).emit("log", `[panel] Cannot reach node "${node.name}" for the live console: ${e.message}\n`);
  });
  relays.set(serverId, socket);
}

/** Close the relay when nobody watches this server any more. */
export function stopRelayIfIdle(mainIo: any, serverId: string) {
  const room = mainIo.sockets.adapter.rooms.get(`server_${serverId}`);
  if (room && room.size > 0) return;
  const s = relays.get(serverId);
  if (s) { s.removeAllListeners(); s.close(); relays.delete(serverId); }
}
