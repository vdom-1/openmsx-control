import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { spawn } from 'child_process';

export interface InstanceManager {
    fetchInstances: () => Promise<OpenMSXInstance[]>;
    spawnInstance: () => Promise<string>;
    resolveInstance: (selection: string) => Promise<string>;
}

export interface OpenMSXInstance {
    pid: string;
    port: string;
    createdAt: string;
}

export const createInstanceManager = (): InstanceManager => {
    const socketDir = process.env.OPENMSX_DEFAULT || path.join(os.tmpdir(), 'openmsx-default');

    const isPortAlive = (port: number): Promise<boolean> => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(500);
            socket.connect(port, '127.0.0.1', () => {
                socket.destroy();
                resolve(true);
            });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { resolve(false); });
        });
    };

    const waitForSocketFile = async (timeoutMs: number = 5000): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (fs.existsSync(socketDir)) {
                const files = fs.readdirSync(socketDir);
                if (files.some(f => f.startsWith('socket.'))) return;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error("Timeout: OpenMSX socket file never appeared.");
    };

    const waitForPortReady = async (port: number, timeoutMs: number = 5000): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await isPortAlive(port)) return;
            await new Promise(r => setTimeout(r, 200));
        }
        throw new Error(`Timeout: Port ${port} never started responding.`);
    };

    const waitForSocket = async (timeoutMs: number = 10000): Promise<void> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (fs.existsSync(socketDir)) {
                const files = fs.readdirSync(socketDir);
                if (files.some(f => f.startsWith('socket.'))) return;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error("Timeout waiting for socket directory");
    };

    const readLatestPort = (): string => {
        const files = fs.readdirSync(socketDir)
            .filter(f => f.startsWith('socket.'))
            .map(f => ({ path: path.join(socketDir, f), mtime: fs.statSync(path.join(socketDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        
        if (files.length === 0) throw new Error("No socket files found");
        return fs.readFileSync(files[0].path, 'utf8').trim();
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
                createdAt: stats.mtime.toLocaleString()
            };
        });
    };

    const spawnInstance = async (): Promise<string> => {
        const exe = process.env.OPENMSX_EXE || 'openmsx.exe';
        spawn(exe, ['-control', 'pipe'], { detached: true, stdio: 'ignore' }).unref();
        await waitForSocketFile(); 
        const portString = readLatestPort();
        const port = parseInt(portString, 10);
        await waitForPortReady(port);
        return portString;
    };

    const resolveInstance = async (selection: string): Promise<string> => {
        if (selection === 'NEW') {
            return await spawnInstance();
        }
        const instances = await fetchInstances();
        const target = instances.find(i => i.pid === selection);        
        if (!target) throw new Error(`Instance with PID ${selection} no longer exists.`);        
        const alive = await isPortAlive(parseInt(target.port, 10));
        if (!alive) {
            throw new Error(`Instance with PID ${selection} appears to be stale (socket exists, but port is not responding).`);
        }

        return target.port;
    };

    return { fetchInstances, spawnInstance, resolveInstance };

};