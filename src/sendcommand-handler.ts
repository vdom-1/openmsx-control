import { Connector } from "./connector.js";
import { InstanceManager, OpenMSXInstance } from './instance-manager.js';

export interface Elicitation {
    message: string;
    mode: 'form';
    requestedSchema: {
        type: 'object'; 
        properties: { [key: string]: any };
        required?: string[];
    };
}

export type DispatcherResult = 
    | { status: 'SUCCESS'; content: string }
    | { status: 'FAILURE'; content: string }
    | { status: 'ELICITATION_REQUIRED'; content: Elicitation };

export const createCommandHandler = (
    connector: Connector, 
    instanceManager: InstanceManager
) => {
    let attachedInstance: OpenMSXInstance | null = null;

    const spawnNewAndConnect = async (command: string): Promise<DispatcherResult> => {
        const newInstance = await instanceManager.spawnInstance();
        await connector.establishConnection(newInstance.port);
        attachedInstance = newInstance;
        const response = await connector.sendCommand(command);
        return { status: response.result === 'ok' ? 'SUCCESS' : 'FAILURE', content: response.content };
    };

    const buildElicitation = (instances: OpenMSXInstance[]): Elicitation => ({
        message: "Multiple sessions found",
        mode: 'form',
        requestedSchema: {
            type: "object",
            properties: {
                instance: {
                    type: 'string',
                    title: 'Choose a socket connection file',
                    description: 'Socket connection files',
                    oneOf: [
                        ...instances.map(i => ({ const: i.port, title: `socket.${i.pid.padEnd(5)} (LastModified=${i.lastModified.toLocaleString()})`  })),
                        { const: 'NEW', title: 'Create new session' }
                    ],
                    default: 'NEW'
                }
            },
            required: ["instance"]
        }
    });

    return {
        executeCommand: async (
            command: string, 
            elicitExecutor: (elicitation: Elicitation) => Promise<{ action: string; content?: any }>
        ): Promise<DispatcherResult> => {
            console.error(`Attached instance ${JSON.stringify(attachedInstance)}`);
            
            // 1. Try connecting to the cached/attached instance
            if (attachedInstance) {
                try {
                    await connector.establishConnection(attachedInstance.port);
                    const response = await connector.sendCommand(command);
                    return { status: response.result === 'ok' ? 'SUCCESS' : 'FAILURE', content: response.content };
                } catch (e) {
                    console.error(`Failed to establish connection to the attached instance. Clearing cache.`);
                    attachedInstance = null;
                }
            }
            
            // 2. Fetch raw instances directly from the system (no runtime checks)
            const instances = await instanceManager.fetchInstances();
            
            // Case A: Zero instances exist on the system -> Cleanly spawn a fresh one
            if (instances.length === 0) {
                console.error("No instances found on system. Spawning fresh.");
                return await spawnNewAndConnect(command);
            }
            
            // Case B: Instances are present -> Present them ALL to the user blindly via elicitation
            try {
                console.error(`Instances found (${instances.length}). Sending elicitation form containing all files.`);
                const elicitationPayload = buildElicitation(instances);
                const elicitResult = await elicitExecutor(elicitationPayload);
                
                if (elicitResult.action !== 'accept' || !elicitResult.content?.instance) {
                    throw new Error("Operation aborted or invalid input received from user.");
                }
                
                const selectedPort = elicitResult.content.instance;
                
                if (selectedPort === 'NEW') {
                    return await spawnNewAndConnect(command);
                } 
                
                const target = instances.find(i => i.port === selectedPort);        
                if (!target) {
                    throw new Error(`Selected instance on port ${selectedPort} vanished from reference list.`);        
                }
                
                // Blindly attempt connection. If the chosen file is stale/dead, 
                // this will natively blow up and route straight to the catch block.
                await connector.establishConnection(selectedPort);
                attachedInstance = target;
                
                const response = await connector.sendCommand(command, 0);
                return { status: response.result === 'ok' ? 'SUCCESS' : 'FAILURE', content: response.content };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Execution sequence failed: ${message}`);
                
                // Returns a explicit failure status to the agent/user.
                // On the next tool execution loop, the stale instance will still be there to choose again.
                return { status: 'FAILURE', content: `Execution failed: ${message}` };
            }
        }
    };
};