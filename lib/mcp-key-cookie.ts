// Shared name for the short-lived HttpOnly cookie used to deliver a freshly
// generated MCP API key from the server action to the next render. Lives in a
// non-'use server' module so both callers (action + server component) can import it.
export const MCP_NEW_KEY_COOKIE = 'docflow_new_mcp_key';
