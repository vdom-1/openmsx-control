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
    const queue: Task[] = [];
    let isProcessing = false;
    let activeInstancePort: string | null = null;
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
        message: "Multiple instances found. Please select one PID.",
        mode: 'form',
        requestedSchema: {
            type: "object",
            properties: {
                instance: {
                    type: 'string',
                    title: 'Instance',
                    description: 'Running instances',
                    oneOf: [
                        ...instances.map(i => ({ const: i.port, title: `PID=${i.pid}, PORT=${i.port}, LastModified=${i.lastModified}`  })),
                        { const: 'NEW', title: 'Spawn new instance' }
                    ],
                    default: 'NEW'
                }
            },
            required: ["instance"]
        }
    });


    return {
        sendCommand: async (command: string) => enqueue(async (): Promise<DispatcherResult> => {
            logger.debug(`1. activeInstancePort ${activeInstancePort}`);
            
            if (activeInstancePort) {
                logger.debug(` isPortAlive ${await connector.isPortAlive(activeInstancePort)}`);
                if (!await connector.isPortAlive(activeInstancePort)) {
                    logger.debug(`erase active port. fall through to fresh session logic`);
                    activeInstancePort = null;
                } else if (!connector.isConnected(activeInstancePort)) {
                    try {
                        await connector.attachInstance(activeInstancePort);
                    } catch (e) {
                        logger.debug(`failed to attach. erase active port. fall through`);
                        activeInstancePort = null;
                    }
                }
            }

            if (activeInstancePort) {
                return { status: 'SUCCESS', content: await connector.sendCommand(command) };
            }

            // 2. FRESH SESSION: No intent established yet.
            const instances = await instanceManager.fetchInstances();

            // Scenario A: No instances exist - Auto-spawn a fresh one
            if (instances.length === 0) {
                const port = await instanceManager.spawnInstance();
                await connector.attachInstance(port);
                activeInstancePort = port; // Lock the session
                return { status: 'SUCCESS', content: await connector.sendCommand(command) };
            }
            // Scenario B: Instances exist - Elicit to gain intent
            return { status: 'ELICITATION_REQUIRED', content: buildElicitation(instances) };
        }),

        resolveElicitation: async (selectedPort: string) => {
            if (selectedPort === 'NEW') {
                const newPort = await instanceManager.spawnInstance();
                await connector.attachInstance(newPort);
                activeInstancePort = newPort;                
                return;
            }
            const instances = await instanceManager.fetchInstances();
            logger.debug(JSON.stringify(instances));
            const target = instances.find(i => i.port === selectedPort);        
            if (!target) throw new Error(`Instance with PORT ${selectedPort} no longer exists.`);        
            const alive = await connector.isPortAlive(target.port);
            if (!alive) {
                throw new Error(`Instance with PID ${selectedPort} appears to be stale (socket exists, but port is not responding).`);
            }
            await connector.attachInstance(selectedPort);
            activeInstancePort = selectedPort; // Session intent locked
        }
    };
};