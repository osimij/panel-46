// Panel's library over MCP, for AI apps that start a local command (Claude Code, Claude
// Desktop, Cursor…): bun server/mcp.ts. Panel itself also serves the same tools at /mcp.
//
// stdout carries the protocol, so anything else that prints must go to stderr.
import "./mcp-quiet.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-tools.ts";

await createMcpServer().connect(new StdioServerTransport());
console.error("Panel MCP: ready");
