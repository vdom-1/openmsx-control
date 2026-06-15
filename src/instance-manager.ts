import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { createLogger, Logger } from './logger.js';
import { spawn, ChildProcess } from 'child_process';

export interface InstanceManager {
    fetchInstances: () => Promise<OpenMSXInstance[]>;
    spawnInstance: () => Promise<string>;
}

export interface OpenMSXInstance {
    pid: string;
    port: string;
    lastModified: string;
}

export const createInstanceManager = (logger: Logger): InstanceManager => {
    const socketDir = process.env.OPENMSX_DEFAULT || path.join(os.tmpdir(), 'openmsx-default');

    const waitForSocketFile = async (pid?: string, timeoutMs: number = 10000): Promise<string> => {
        const start = Date.now();
        const expectedFilename = `socket.${pid}`;
        const filePath = path.join(socketDir, expectedFilename);
        logger.debug(`Waiting for specific socket file: ${expectedFilename}`);
        while (Date.now() - start < timeoutMs) {
            if (fs.existsSync(filePath)) {
                try {
                    const port = fs.readFileSync(filePath, 'utf8').trim();                    
                    if (port && port.length > 0) {
                        logger.debug(`Successfully found port: ${port} from ${expectedFilename}`);
                        return port;
                    }
                } catch (e) {
                    // File exists but might be locked by the process writing it. 
                    // We just wait for the next loop iteration.
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }
        throw new Error(`Timeout: Socket file ${expectedFilename} never appeared.`);
    };

    const fetchInstances = async (): Promise<OpenMSXInstance[]> => {
        if (!fs.existsSync(socketDir)) return [];
        const files = fs.readdirSync(socketDir).filter((f) => f.startsWith('socket.'));        
        return files.map((file): OpenMSXInstance => {
            const filePath = path.join(socketDir, file);
            const stats = fs.statSync(filePath);
            const port = fs.readFileSync(filePath, 'utf8').trim();            
            return { 
                pid: file.split('.')[1],
                port: port,
                lastModified: stats.mtime.toLocaleString()
            };
        });
    };

    const spawnInstance = async (): Promise<string> => {
        const exe = process.env.OPENMSX_EXE || 'openmsx.exe';
        const childProcess: ChildProcess = spawn(exe, ['-control', 'pipe'], { detached: true, stdio: 'ignore' });
        childProcess.unref();
        const pid = childProcess.pid?.toString(); 
        logger.debug(`childProcess.pid?.toString()=${pid}`)      
        return await waitForSocketFile(pid); 
    };


    return { fetchInstances, spawnInstance };

};