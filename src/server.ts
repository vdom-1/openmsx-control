#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLogger } from "./logger.js";
import { createSSPIAuthenticator } from "./sspi-authenticator.js";
import { createWorker } from "./worker.js";
import { createDispatcher } from "./dispatcher.js";

const server = new McpServer({
    name: "openmsx-control-server",
    version: "1.0.0",}, {
        capabilities: {}
});

const logger = createLogger(server);
const authenticator = createSSPIAuthenticator(logger);
const worker = createWorker(logger, authenticator);
const dispatcher = createDispatcher(worker);

const createServer = () => {
    server.registerTool(
        "sendCommand", 
        {
            description: "Sends a command to the openMSX instance.",
            inputSchema: z.object({ command: z.string().describe("e.g., 'help', 'list_media'") })
        },
        async ({ command }) => {
            try {
                
                const response = await dispatcher.sendCommand(command);
                if(response.status==='ELICTATION_REQUIRED'){
                    const selectInstance = await server.server.elicitInput({message: '',requestedSchema: {type: 'object', properties:{}}}); //response.content
                     if (selectInstance.action == 'accept') {
                        const isInstanceAttached = await dispatcher.attachInstance("PID");//selectInstance.content?
                        if(!isInstanceAttached){
                            return { content: [{ type: "text", text: "Error: Could not attach to instance. Try another instance or start a new one." }] };
                        }
                        const response = await dispatcher.sendCommand(command);
                        const text = [`status: ${response.status}`, `content: ${response.content || "(empty)"}`].join('\n');
                        return {
                        content: [{ type: "text", text }] };
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