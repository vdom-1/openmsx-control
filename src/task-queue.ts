interface Task {
    action: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

export const createTaskQueue = () => {
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
        execute: <T>(action: () => Promise<T>): Promise<T> => {
            return new Promise((resolve, reject) => {
                queue.push({ action, resolve, reject });
                processQueue();
            });
        }
    };
};