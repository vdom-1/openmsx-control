#!/usr/bin/env node

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from 'zod';
import { createLogger } from "./logger.js";
import { createSSPIAuthenticator } from "./sspi-authenticator.js";
import { createConnector } from "./connector.js";
import { createTaskQueue } from "./task-queue.js";
import { createInstanceManager } from './instance-manager.js';
import { createCommandHandler } from './sendcommand-handler.js';
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface ActiveSession {
    server: McpServer;
    transport: NodeStreamableHTTPServerTransport;
}
const sessions = new Map<string, ActiveSession>();

const createServerInstance = () => {
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
    const taskQueue = createTaskQueue();

    server.registerResource(
        'sendCommandGuide',
        'openmsx-control://sendcommand/guide',
        {
            title: 'OpenMSX Emulator Discovery Guide',
            description: "The authoritative starting point for understanding and exploring the emulator's interface.",
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

const app = createMcpExpressApp({
    host: '0.0.0.0',
    allowedHosts: [
        'localhost',
        '127.0.0.1',
        process.env.ALLOWEDHOST || '172.25.80.1'
    ]
});

app.all('/mcp', async (req, res) => {
    const sessionId = (req.headers['mcp-session-id'] || req.query.sessionId) as string;
    let currentSession = sessionId ? sessions.get(sessionId) : undefined;

    const isGetRequest = req.method === 'GET';
    const isInitializePost = req.method === 'POST' && req.body?.method === 'initialize';

    if ((isGetRequest || isInitializePost) && !currentSession) {
        const targetId = sessionId || randomUUID();
        const server = createServerInstance();
        
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: () => targetId,
            onsessionclosed: () => {
                console.log(`Closing session: ${targetId}`);
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
            error: { code: -32002, message: "Session not found or expired" },
            id: req.body?.id || null
        });
    }

    await currentSession.transport.handleRequest(req, res, req.body);
});

const HOST = '0.0.0.0';
const PORT = 3000;
app.listen(PORT, HOST, () => {
    console.log(`openmsx-control server listening on port ${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Shutting down server...');
    for (const [id, session] of sessions.entries()) {
        session.transport.close();
        session.server.close();
    }
    process.exit(0);
});