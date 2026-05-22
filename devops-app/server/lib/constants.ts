export const LOCAL_SERVER_ID = "c4a760a8-dbcf-5254-a0d9-6a4474bd1b62";

/**
 * Checks if the given server ID corresponds to the local server.
 */
export function isLocalServer(serverId: string): boolean {
  return serverId === LOCAL_SERVER_ID;
}
