import { Connector } from "./connector.js";
import { InstanceManager, OpenMSXInstance } from './instance-manager.js';


interface Task {
    action: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

interface ElicitationRequest {
    message: string;
    mode: 'form';
    requestedSchema: {
        type: "object";
        properties: {
            instance: {
                type: 'string';
                title: 'Instance';
                description: 'Running instances';
                oneOf: Array<{ const: string; title: string }>;
                default: string;
            };
        };
        required: ["instance"];
    };
}

export type DispatcherResult = 
    | { status: 'SUCCESS'; content: string }
    | { status: 'ELICITATION_REQUIRED'; content: ElicitationRequest };


export const createDispatcher = (
        connector: Connector, 
        instanceManager: InstanceManager
    ):{
        sendCommand: (command: string) => Promise<DispatcherResult>;
        resolveAndAttach: (selection: string) => Promise<void>; 
    } => {
    const queue: Task[] = [];
    let isProcessing = false;
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

    const buildElicitation = (instances: OpenMSXInstance[]): ElicitationRequest => ({
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
                            ...instances.map(i => ({ const: i.pid, title: `Instance PID ${i.pid} on port ${i.port} at ${i.createdAt}`  })),
                            { const: 'NEW', title: 'Spawn new instance' }
                        ],
                        default: 'NEW'
                    }
                },
                required: ["instance"]
            }
        });

    return {
        sendCommand: (command: string) => enqueue(async (): Promise<DispatcherResult> => {

            const instances = await instanceManager.fetchInstances();
            const isAttached = connector.isConnected();
            const currentPort = connector.getCurrentPort();

            // 1. SCENARIO: Zero Instances
            if (instances.length === 0) {
                const port = await instanceManager.spawnInstance();
                await connector.attachInstance(port);
                return { status: 'SUCCESS', content: await connector.sendCommand(command) };
            }

          // 2. SCENARIO: One Instance
            if (instances.length === 1) {
                const target = instances[0];
                // Only proceed if already attached to this specific instance
                if (isAttached && currentPort === target.port) {
                    return { status: 'SUCCESS', content: await connector.sendCommand(command) };
                }
                // Otherwise, ask the user (as per your requirement: they might want a new one)
                return { status: 'ELICITATION_REQUIRED', content: buildElicitation(instances) };
            }

            // 3. SCENARIO: Multiple Instances
            if (instances.length > 1) {
                // Check if we are already attached to one of the valid instances
                const isAttachedToValid = isAttached && instances.some(i => i.port === currentPort);
                
                if (isAttachedToValid) {
                    return { status: 'SUCCESS', content: await connector.sendCommand(command) };
                }
                // If not attached, or attached to a stale/dead instance, force choice
                return { status: 'ELICITATION_REQUIRED', content: buildElicitation(instances) };
            }

            // Fallback error
            throw new Error("Unexpected instance state");
        }),

        resolveAndAttach: (selection: string) => enqueue(async () => {
            const port = await instanceManager.resolveInstance(selection);
            await connector.attachInstance(port);
        })
    };
};