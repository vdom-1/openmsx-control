import { Logger } from './logger.js';
import { Connector } from "./connector.js";
import { InstanceManager, OpenMSXInstance } from './instance-manager.js';

interface Task {
    action: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

interface Elicitation {
    message: string;
    mode: 'form';
    requestedSchema: {
        type: 'object'; 
        properties: {
            [key: string]: any;
        };
        required?: string[];
    };
}

export type DispatcherResult = 
    | { status: 'SUCCESS'; content: string }
    | { status: 'ELICITATION_REQUIRED'; content: Elicitation };


export const createDispatcher = ( logger: Logger, connector: Connector, instanceManager: InstanceManager ): {
        sendCommand: (command: string) => Promise<DispatcherResult>;
        resolveElicitation: (selection: string) => Promise<void>; 
    } => {            
    connector.on('command', (command) => { logger.info(`Command Sent: ${command}`); });
    connector.on('reply', (reply) => { logger.info(`Reply Received: ${reply}`); });
    connector.on('connected', (message) => { logger.info(message); });
    const queue: Task[] = [];
    let isProcessing = false;
    let attachedInstance: OpenMSXInstance | null = null;
    const processQueue = async () => {
        if (isProcessing || queue.length === 0) return;
        isProcessing = true;
        const task = queue.shift();
        if (task) {
            try {
                const result = await task.action();
                task.resolve(result);
            } catch (e) {
                task.reject(e);
            }
        }
        isProcessing = false;
        await processQueue();
    };

    const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
        return new Promise((resolve, reject) => {
            queue.push({ action, resolve, reject });
            processQueue();
        });
    };

    const buildElicitation = (instances: OpenMSXInstance[]): Elicitation => ({
        message: "Multiple socket connection files found",
        mode: 'form',
        requestedSchema: {
            type: "object",
            properties: {
                instance: {
                    type: 'string',
                    title: 'Choose a socket connection file',
                    description: 'Socket connection files',
                    oneOf: [
                        ...instances.map(i => ({ const: i.port, title: `socket.${i.pid} (LastModified=${i.lastModified})`  })),
                        { const: 'NEW', title: 'Start fresh instance' }
                    ],
                    default: 'NEW'
                }
            },
            required: ["instance"]
        }
    });


    return {
        sendCommand: async (command: string) => enqueue(async (): Promise<DispatcherResult> => {
            logger.info(`Attached instance ${JSON.stringify(attachedInstance)}`)
            if (attachedInstance) {
                try {
                    await connector.establishConnection(attachedInstance.port);
                } catch (e) {
                    logger.warning(`Failed to stablish connection to the attached instance`);
                    logger.info(`Falling through to spawing a new instance`);
                    attachedInstance = null;
                }
            }
            if (attachedInstance) {
                return { status: 'SUCCESS', content: await connector.sendCommand(command) };
            }
            const instances = await instanceManager.fetchInstances();
            if (instances.length === 0) {
                const newInstance = await instanceManager.spawnInstance();
                await connector.establishConnection(newInstance.port);
                attachedInstance = newInstance;
                return { status: 'SUCCESS', content: await connector.sendCommand(command) };
            }
            return { status: 'ELICITATION_REQUIRED', content: buildElicitation(instances) };
        }),

        resolveElicitation: async (selectedPort: string) => {
            if (selectedPort === 'NEW') {
                const newInstance = await instanceManager.spawnInstance();
                await connector.establishConnection(newInstance.port);
                attachedInstance = newInstance;                
                return;
            }
            const instances = await instanceManager.fetchInstances();
            logger.debug(JSON.stringify(instances));
            const target = instances.find(i => i.port === selectedPort);        
            if (!target) throw new Error(`Instance with PORT ${selectedPort} no longer exists.`);        
            const alive = await connector.isConnected(target.port);
            if (!alive) {
                throw new Error(`Instance with PID ${selectedPort} appears to be stale (socket exists, but port is not responding).`);
            }
            await connector.establishConnection(selectedPort);
            attachedInstance = target;
        }
    };
};