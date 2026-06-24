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
import { text } from "stream/consumers";

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
        'toolGuide',
        'openmsx-control://guide',
        {
            title: 'OpenMSX discovery',
            description: 'Use this resource to learn about the API',
            mimeType: 'text/markdown'
        },
        async uri => {
            const targetPath = './src/openmsx-guide.md';        
            const absolutePath = path.resolve(targetPath);
            try {
                const guide = fs.readFileSync(targetPath, 'utf8');
                return {            
                    contents: [{ 
                        uri: uri.href,                        
                        text: guide 
                    }]
                };
            } catch (err) {
                logger.error(`Failed to read ${absolutePath} inside resource: ${err}`);
                return { contents: [] };
            }
        }
    );
    server.registerTool(
        "sendCommand", 
        {
            description: "Sends a command to the openMSX instance.",
            inputSchema: z.object({ command: z.string().describe("For guidance on how to operate this tool, refer to `openmsx-control://guide`") })
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