#!/usr/bin/env node

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { randomUUID } from 'node:crypto';
import { createServerInstance } from "./server.js";

interface ActiveSession {
    server: McpServer;
    transport: NodeStreamableHTTPServerTransport;
}
const sessions = new Map<string, ActiveSession>();

// --- HTTP Transport Setup ---
function startHttpServer() {
    const app = createMcpExpressApp({
        host: '0.0.0.0',
        allowedHosts: [
            'localhost',
            '127.0.0.1',
            process.env.ALLOWEDHOST || '0.0.0.0'
        ]
    });

    app.all('/mcp', async (req, res) => {
        const sessionId = (req.headers['mcp-session-id'] || req.query.sessionId) as string;
        let currentSession = sessionId ? sessions.get(sessionId) : undefined;
        const isGetRequest = req.method === 'GET';
        const isInitializePost = req.method === 'POST' && req.body?.method === 'initialize';
        if (!currentSession && (isGetRequest || isInitializePost || !sessionId)) {
            const targetId = sessionId || randomUUID();
            const server = createServerInstance();
            const transport = new NodeStreamableHTTPServerTransport({
                sessionIdGenerator: () => targetId,
                onsessionclosed: () => {
                    console.log(`[openmsx-control] Closing session: ${targetId}`);
                    server.close();
                    sessions.delete(targetId);
                }
            });
            await server.connect(transport);
            currentSession = { server, transport };            
            sessions.set(targetId, currentSession);
        }
        if (!currentSession) {
            return res.status(404).json({
                jsonrpc: "2.0",
                error: { code: -32002, message: "Session not found or expired." },
                id: req.body?.id || null
            });
        }
        console.log(`[openmsx-control] mcp-session-id: ${sessionId || 'new-session'}`);
        await currentSession.transport.handleRequest(req, res, req.body);
    });

    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`[openmsx-control] Listening on port ${PORT}`);
    });

    process.on('SIGINT', () => {
        console.log('[openmsx-control] Shutting down server...');
        for (const [id, session] of sessions.entries()) {
            session.transport.close();
            session.server.close();
        }
        process.exit(0);
    });
}

// --- Stdio Transport Setup ---
function startStdioServer() {
    console.error("[openmsx-control] Running on stdio");
    serveStdio(createServerInstance);
}

const useStdio = process.env.TRANSPORT?.toLowerCase() === 'stdio';

if (useStdio) {
    startStdioServer();
} else {
    startHttpServer();
}