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
    | { status: 'FAILURE'; content: string }
    | { status: 'ELICITATION_REQUIRED'; content: Elicitation };


export const createDispatcher = (logger: Logger, connector: Connector, instanceManager: InstanceManager): {
        sendCommand: (
            command: string, 
            elicitExecutor: (elicitation: Elicitation) => Promise<{ action: string; content?: any }>
        ) => Promise<DispatcherResult>;

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
                        ...instances.map(i => ({ const: i.port, title: `socket.${i.pid} (LastModified=${i.lastModified})`  })),
                        { const: 'NEW', title: 'Create new session' }
                    ],
                    default: 'NEW'
                }
            },
            required: ["instance"]
        }
    });


    return {
        sendCommand: async (command: string, elicitExecutor: (elicitation: Elicitation) => Promise<{ action: string; content?: any }>) => enqueue(async (): Promise<DispatcherResult> => {
            logger.info(`Attached instance ${JSON.stringify(attachedInstance)}`)
            
            // 1. Try connecting to the cached/attached instance
            if (attachedInstance) {
                try {
                    await connector.establishConnection(attachedInstance.port);
                } catch (e) {
                    logger.warning(`Failed to establish connection to the attached instance`);
                    logger.info(`Falling through to spawning a new instance`);
                    attachedInstance = null;
                }
            }
            
            // 2. If successfully attached, fire command immediately
            if (attachedInstance) {
                const response = await connector.sendCommand(command);
                const status = response.result === 'ok' ? 'SUCCESS' : 'FAILURE';                
                return { status, content: response.content };
            }
            
            // 3. Look for available processes
            const instances = await instanceManager.fetchInstances();
            
            // Case A: No instances exist -> Spawn brand new
            if (instances.length === 0) {
                const newInstance = await instanceManager.spawnInstance();
                await connector.establishConnection(newInstance.port);
                attachedInstance = newInstance;
                const response = await connector.sendCommand(command);
                const status = response.result === 'ok' ? 'SUCCESS' : 'FAILURE';                
                return { status, content: response.content };                
            }
            
            // Case B: Multiple instances exist -> Trigger ATOMIC inline elicitation
            try {
                // Generate the prompt payload completely inside the dispatcher
                const elicitationPayload = buildElicitation(instances);
                
                // Pause execution inline and wait for the tool layer to fetch human response
                const elicitResult = await elicitExecutor(elicitationPayload);
                
                if (elicitResult.action !== 'accept' || !elicitResult.content?.instance) {
                    throw new Error("Operation aborted or invalid input received from user.");
                }
                
                const selectedPort = elicitResult.content.instance;
                
                // Process the human selection inside the safety lock
                if (selectedPort === 'NEW') {
                    const newInstance = await instanceManager.spawnInstance();
                    await connector.establishConnection(newInstance.port);
                    attachedInstance = newInstance;                
                } else {
                    logger.debug(JSON.stringify(instances));
                    const target = instances.find(i => i.port === selectedPort);        
                    if (!target) throw new Error(`Instance with PORT ${selectedPort} no longer exists.`);        
                    
                    const alive = await connector.isConnected(target.port);
                    if (!alive) {
                        throw new Error(`Instance with PORT ${selectedPort} appears to be stale (socket exists, but port is not responding).`);
                    }
                    
                    await connector.establishConnection(selectedPort);
                    attachedInstance = target;
                }
                
                // Execute the deferred command immediately now that connection is established
                const response = await connector.sendCommand(command, 0);
                const status = response.result === 'ok' ? 'SUCCESS' : 'FAILURE';                
                return { status, content: response.content };

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { status: 'FAILURE', content: `Elicitation workflow failed: ${message}` };
            }
        })
   
    };
};