#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createLogger } from "./logger.js";
import { createSSPIAuthenticator } from "./sspi-authenticator.js";
import { createConnector } from "./connector.js";
import { createDispatcher } from "./dispatcher.js";
import { createInstanceManager } from './instance-manager.js';
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
const dispatcher = createDispatcher(logger, connector, instanceManager);


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
            //const targetPath = './res/sendcommand-guide.md';        
            //const absolutePath = path.resolve(targetPath);

            const filename = fileURLToPath(import.meta.url);
            const dirname = path.dirname(filename);
            const guidePath = path.join(dirname, '..', 'res', 'sendcommand-guide.md');

            try {
                const guide = fs.readFileSync(guidePath, 'utf8');
                return {            
                    contents: [{ 
                        uri: uri.href,                        
                        text: guide 
                    }]
                };
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
            inputSchema: z.object({ command: z.string().describe("e.g., 'help', 'help <command>', 'openmsx_info setting', 'help set <setting>', 'machine_info', 'openmsx_info', 'about<keyword>'") })
        },
        async ({ command }) => {
            try {                
                const response = await dispatcher.sendCommand(command);
                if(response. status==='ELICITATION_REQUIRED'){
                    const selectedInstance:ElicitResult = await server.server.elicitInput(response.content);
                    logger.debug("Elicitation Result" + JSON.stringify(selectedInstance, null, 2));
                     if (selectedInstance.action == 'accept'&& 
                        typeof selectedInstance.content === 'object' && 
                        selectedInstance.content !== null &&
                        'instance' in selectedInstance.content) {
                        await dispatcher.resolveElicitation(selectedInstance.content.instance as string);
                        const response = await dispatcher.sendCommand(command);
                        const text = [`status: ${response.status}`, `content: ${response.content || "(empty)"}`].join('\n');
                        return {
                        content: [{ type: "text", text }] };
                    }else{
                        throw new Error("Operation aborted! Must select an instance or spawn a new one.");
                    }
                }                     
                const text = [`status: ${response.status}`, `content: ${response.content || "(empty)"}`].join('\n');
                return {
                        content: [{ type: "text", text }] };                        
                }
             catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Command execution failed: ${message}`);
                return { 
                    content: [{ type: "text", text: `Error: ${message}` }] 
                };
            }
        }
    );
    return server;    
}

const transport = new StdioServerTransport();
await createServer().connect(transport);