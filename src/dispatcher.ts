import { Worker } from "./worker.js";

interface Task {
    action: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

export const createDispatcher = (worker: Worker) => {
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

    return {
        sendCommand: (command: string) => {
            return new Promise<{ status: string, content: string | null }>((resolve, reject) => {
                queue.push({
                    action: () => worker.sendCommand(command),
                    resolve,
                    reject
                });
                processQueue();
            });
        },
        attachInstance: (pid: string): Promise<boolean> => {
            return new Promise((resolve, reject) => {
                queue.push({
                    action: () => worker.sendCommand(pid),//ATTACH
                    resolve,
                    reject
                });
                processQueue();
            });
        }
    };
};