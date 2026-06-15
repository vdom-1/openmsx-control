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
    server.registerTool(
        "sendCommand", 
        {
            description: "Sends a command to the openMSX instance.",
            inputSchema: z.object({ command: z.string().describe("e.g., 'help','help <command>' ,'help <command> <subcommand>' ,'openmsx_info setting' ,'help set <setting>'") })
        },
        async ({ command }) => {
            try {                
                const response = await dispatcher.sendCommand(command);
                if(response. status==='ELICITATION_REQUIRED'){
                    const selectedInstance:ElicitResult = await server.server.elicitInput(response.content);
                    logger.debug("DEBUG - Elicitation Result:" + JSON.stringify(selectedInstance, null, 2));
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