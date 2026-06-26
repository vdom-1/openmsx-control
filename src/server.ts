#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const server = new McpServer({
    name: "openmsx-control-server",
    version: "1.0.0"
}, {
    capabilities: {}
});

const logger = createLogger(server);
const authenticator = createSSPIAuthenticator(logger);
const instanceManager = createInstanceManager(logger);
const connector = createConnector(logger, authenticator);
const commandHandler = createCommandHandler(logger, connector, instanceManager);
const taskQueue = createTaskQueue();

const createServer = () => {   
    server.registerResource(
        'sendCommandGuide',
        'openmsx-control://sendcommand/guide',
        {
            title: 'OpenMSX Emulator Discovery Guide',
            description: 'The authoritative starting point for understanding and exploring the emulator\'s interface. Use it whenever you need to determine available actions, inspect capabilities, or resolve uncertainty about command behavior.',
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
            description: "Sends a command to the openMSX instance.",
            inputSchema: z.object({ 
                command: z.string().describe("e.g., 'help', 'help <command>', 'openmsx_info setting', 'help set <setting>', 'machine_info', 'openmsx_info', 'about<keyword>'") 
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
                logger.error(`Command execution failed: ${message}`);
                return { content: [{ type: "text", text: `Error: ${message}` }] };
            }
        }
    );

    return server;    
}

const transport = new StdioServerTransport();
await createServer().connect(transport);