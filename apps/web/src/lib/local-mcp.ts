export const LOCAL_MCP_STORAGE_KEY = 'dbugr_local_mcp_connectors';

export interface LocalMcpConnector {
  id: string;
  name: string;
  url: string;
  headerName: string;
  apiKey: string;
  createdAt: string;
}

export function createLocalMcpId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `mcp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function maskSecret(value: string) {
  if (!value) return 'No key saved';
  if (value.length <= 8) return 'Saved locally';
  return `•••• ${value.slice(-4)}`;
}

export function readLocalMcpConnectors(): LocalMcpConnector[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_MCP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalMcpConnector[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[phase2-web] local_mcp.read_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function writeLocalMcpConnectors(connectors: LocalMcpConnector[]) {
  window.localStorage.setItem(LOCAL_MCP_STORAGE_KEY, JSON.stringify(connectors));
  console.info('[phase2-web] local_mcp.saved', {
    connectorCount: connectors.length,
    connectorNames: connectors.map((connector) => connector.name),
  });
}
