import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';

export interface InstanceManager {
    fetchInstances: () => Promise<OpenMSXInstance[]>;
    spawnInstance: () => Promise<OpenMSXInstance>;
}

export interface OpenMSXInstance {
    pid: string;
    port: string;
    lastModified: Date;
}

export const createInstanceManager = (): InstanceManager => {
    const socketDir = process.env.OPENMSX_DEFAULT || path.join(os.tmpdir(), 'openmsx-default');

    const waitForSocketFile = async (pid: string, timeoutMs: number = 10000): Promise<OpenMSXInstance> => {
        const start = Date.now();
        const expectedFilename = `socket.${pid}`;
        const filePath = path.join(socketDir, expectedFilename);
        console.error(`[openmsx-control] Waiting for socket file: '${filePath}'`);
        while (Date.now() - start < timeoutMs) {
            if (fs.existsSync(filePath)) {
                console.error(`[openmsx-control] Socket file found: '${filePath}'`);
                return {
                    pid: pid,
                    port: fs.readFileSync(filePath, 'utf8').trim(),
                    lastModified: fs.statSync(filePath).mtime
                };
            }
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error(`TIMEOUT: Socket file '${filePath}' never appeared.`);
    };

    return { 

            fetchInstances: async (): Promise<OpenMSXInstance[]> => {
                if (!fs.existsSync(socketDir)) return [];
                const files = fs.readdirSync(socketDir).filter((f) => f.startsWith('socket.'));        
                return files.map((file): OpenMSXInstance => {
                    const filePath = path.join(socketDir, file);
                    const stats = fs.statSync(filePath);
                    const port = fs.readFileSync(filePath, "utf8").trim();
                    return {
                        pid: file.split(".")[1],
                        port,
                        lastModified: stats.mtime,
                    };
                }).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
            },

        spawnInstance: async (): Promise<OpenMSXInstance> => {
            const exe = process.env.OPENMSX_EXE || 'openmsx.exe';
            const childProcess: ChildProcess = spawn(exe, ['-control', 'pipe'], { detached: true, stdio: 'ignore' });
            childProcess.unref();
            const pid = childProcess.pid?.toString();
            if(!pid){
                throw new Error("Failed to spawn new instance");
            }
            console.error(`[openmsx-control] Instance PID: ${pid}`)      
            return await waitForSocketFile(pid); 
        }

     };

};