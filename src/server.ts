#!/usr/bin/env node

import express, { type Request, type Response } from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"; 
import { z } from "zod";
import { createLogger } from "./logger.js";
import { createSSPIAuthenticator } from "./sspi-authenticator.js";
import { createConnector } from "./connector.js";
import { createTaskQueue } from "./task-queue.js";
import { createInstanceManager } from './instance-manager.js';
import { createCommandHandler } from './sendcommand-handler.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Shared application task queue
const taskQueue = createTaskQueue();

// In-memory state storage tracking active client connection sessions
interface ActiveSession {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
}
const activeSessions = new Map<string, ActiveSession>();

/**
 * Factory helper that instantiates and pre-configures a fresh, isolated 
 * state context loop package containing an McpServer instance.
 */
const buildNewServerInstance = () => {
    const server = new McpServer({
        name: "openmsx-control-server",
        version: "1.0.0"
    }, {
        capabilities: {
            logging: {}, 
            resources: { listChanged: true, subscribe: true }, 
            tools: { listChanged: true }
        }
    });

    const logger = createLogger(server);
    const authenticator = createSSPIAuthenticator(logger);
    const instanceManager = createInstanceManager(logger);
    const connector = createConnector(logger, authenticator);
    const commandHandler = createCommandHandler(logger, connector, instanceManager);

    server.registerResource(
        'sendCommandGuide',
        'openmsx-control://sendcommand/guide',
        {
            title: 'OpenMSX Emulator Discovery Guide',
            description: 'The authoritative starting point for understanding and exploring the emulator\'s interface.',
            mimeType: 'text/markdown'
        },
        async uri => {            
            const filename = fileURLToPath(import.meta.url);
            const dirname = path.dirname(filename);
            const guidePath = path.join(dirname, '..', 'res', 'sendcommand-guide.md');
            try {
                const guide = fs.readFileSync(guidePath, 'utf8');
                return { contents: [{ uri: uri.href, text: guide }] };
            } catch (err) {
                logger.error(`Failed to read ${guidePath} inside resource: ${err}`);
                return { contents: [] };
            }
        }
    );

    server.registerTool(
        "sendCommand", 
        {
            description: "Sends a command to the openMSX.",
            inputSchema: z.object({ 
                command: z.string().describe("Read `sendCommand-guide` tool resource") 
            })
        },
        async ({ command }) => {
            try {
                const response = await taskQueue.execute(() => 
                    commandHandler.executeCommand(command, async (elicitationPayload) => {
                        return await server.server.elicitInput(elicitationPayload);
                    })
                );
                const text = [`status: ${response.status}`, `content: ${response.content || "(empty)"}`].join('\n');
                return { content: [{ type: "text", text }] }; 
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: [{ type: "text", text: `Error: ${message}` }] };
            }
        }
    );

    return server;
};

// Use the official MCP Express app factory which configures proper host-header/DNS rebinding security
const app = createMcpExpressApp();
app.use(express.json());

const handleMcpRoutingRequest = async (req: Request, res: Response) => {
    // 1. Identify or negotiate the session ID context
    let sessionId = req.headers['mcp-session-id'] as string || req.query.sessionId as string;
    const isInitialize = req.body && req.body.method === 'initialize';

    let currentSession = sessionId ? activeSessions.get(sessionId) : undefined;

    // 2. If it's a new initialize request or session isn't found, spin up a brand new state block
    if (isInitialize || !currentSession) {
        // Generate a new key if the client didn't supply one
        if (!sessionId) {
            sessionId = Math.random().toString(36).substring(2, 15);
        }

        const fallbackServer = buildNewServerInstance();
        const fallbackTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId
        });

        await fallbackServer.connect(fallbackTransport);
        
        currentSession = { server: fallbackServer, transport: fallbackTransport };
        activeSessions.set(sessionId, currentSession);
    }

    // Ensure the response lets the client know which session context is active
    res.setHeader('Mcp-Session-Id', sessionId);

    // 3. Clean up memory handles on client drop/termination
    res.on('close', () => {
        if (req.method === 'DELETE' && sessionId) {
            currentSession?.transport.close();
            currentSession?.server.close();
            activeSessions.delete(sessionId);
        }
    });

    // 4. Delegate runtime execution directly to the matching isolated session transport
    try {
        await currentSession.transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error(`Error handling stateful request for session ${sessionId}:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null
            });
        }
    }
};

app.post('/mcp', handleMcpRoutingRequest);
app.get('/mcp', handleMcpRoutingRequest);
app.delete('/mcp', handleMcpRoutingRequest);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Stateful Multi-Session Streamable HTTP Server listening on port ${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    for (const [id, session] of activeSessions.entries()) {
        session.transport.close();
        session.server.close();
    }
    process.exit(0);
});