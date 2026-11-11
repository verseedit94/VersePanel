import { Request, Response } from "express";
import { readJSON } from "./db.js";

/** Loads the server for :id and checks the caller (owner of the server, admin or owner role). Sends the error itself. */
export async function loadServerForRequest(req: Request, res: Response): Promise<any | null> {
  const user = (req as any).user;
  const servers = (await readJSON("servers.json")) || [];
  const server = servers.find((s: any) => s.id === req.params.id);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return null;
  }
  if (user && user.role !== "admin" && user.role !== "owner" && server.owner !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return server;
}

export const isStaff = (u: any) => !!u && (u.role === "admin" || u.role === "owner");
