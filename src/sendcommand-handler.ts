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

export type CommandResult = 
    | { status: 'SUCCESS'; content: string }
    | { status: 'FAILURE'; content: string }
    | { status: 'ELICITATION_REQUIRED'; content: Elicitation };

export const createCommandHandler = (
    connector: Connector, 
    instanceManager: InstanceManager
) => {
    let attachedInstance: OpenMSXInstance | null = null;

    const spawnNewAndConnect = async (command: string): Promise<CommandResult> => {
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
        ): Promise<CommandResult> => {
            console.error(`[openmsx-control] Attached instance: ${JSON.stringify(attachedInstance)}`);
            if (attachedInstance) {
                try {
                    await connector.establishConnection(attachedInstance.port);
                    const response = await connector.sendCommand(command);
                    return { status: response.result === 'ok' ? 'SUCCESS' : 'FAILURE', content: response.content };
                } catch (e) {
                    console.error(`[openmsx-control] Unable to establish connection to the attached instance. Clearing cache.`);
                    attachedInstance = null;
                }
            }
            const instances = await instanceManager.fetchInstances();
            if (instances.length === 0) {
                console.error("[openmsx-control] Spawning new instance");
                return await spawnNewAndConnect(command);
            }
            try {
                console.error(`[openmsx-control] ${instances.length}x instance(s) found. Sending elicitation form.`);
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
                await connector.establishConnection(selectedPort);
                attachedInstance = target;
                
                const response = await connector.sendCommand(command, 0);
                return { status: response.result === 'ok' ? 'SUCCESS' : 'FAILURE', content: response.content };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[openmsx-control] Unexpected error: ${message}`);
                return { status: 'FAILURE', content: `Execution failed: ${message}` };
            }
        }
    };
};