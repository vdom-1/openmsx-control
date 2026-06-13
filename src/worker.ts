import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { SSPIAuthenticator } from './sspi-authenticator.js';

export interface Worker {
    on: (event: string, listener: (...args: any[]) => void) => void;
    ensureRunning: () => Promise<void>;
    sendCommand: (command: string) => Promise<{ status: string, content: string | null }>;
}

export const createWorker = (logger: Logger, authenticator: SSPIAuthenticator): Worker => {
    const emitter = new EventEmitter();
    let client: net.Socket | null = null;
    let emuProcess: ChildProcess | null = null;
    let isReady = false;
    let initPromise: Promise<void> | null = null;

    const parseResponse = (xml: string) => {
        const attrMatch = xml.match(/result="([^"]+)"/);
        const contentMatch = xml.match(/>([^<]+)<\/reply>/);
        const rawContent = contentMatch ? contentMatch[1] : null;
        const decodeEntities = (str: string | null) => {
            if (!str) return null;
            return str.replace(/&apos;/g, "'").replace(/&#x0a;/g, "\n").replace(/&quot;/g, '"')
                      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        };
        return { status: attrMatch ? attrMatch[1] : 'unknown', content: decodeEntities(rawContent) };
    };

    const waitForSocket = (dir: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timeout waiting for socket directory")), 10000);
            const check = () => {
                if (fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.startsWith('socket.'))) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    };

    const readPort = (dir: string): number => {
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('socket.'))
            .map(f => ({ path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) throw new Error("No socket files found");
        return parseInt(fs.readFileSync(files[0].path, 'utf8').trim(), 10);
    };
    
    const handleIncomingData = (data: Buffer) => {
        const rawOutput = data.toString();
        if (rawOutput.includes('<openmsx-output>')) return;        
        if (rawOutput.includes('</reply>')) {
            emitter.emit('reply', rawOutput);
        } else if (rawOutput.includes('<log') || rawOutput.includes('<error')) {
            const lower = rawOutput.toLowerCase();
            if (lower.includes('error')) {
                logger.error(rawOutput); 
            } else if (lower.includes('warn')) {
                logger.warning(rawOutput);
            } else {
                logger.info(rawOutput);
            }
        }
    };

    const ensureRunning = async (): Promise<void> => {
        if (isReady && client && !client.destroyed) return;
        if (initPromise) return initPromise;
        initPromise = (async () => {
            logger.debug("ensureRunning(): Spawning emulator process...");
            emuProcess = spawn(process.env.OPENMSX_EXE || 'openmsx.exe', ['-control', 'pipe']);            
            const socketDir = process.env.OPENMSX_DEFAULT || path.join(os.tmpdir(),'openmsx-default') ;
            await waitForSocket(socketDir);
            const port = readPort(socketDir);            
            client = new net.Socket();
            client.on('data', handleIncomingData);            
            await new Promise<void>((resolve, reject) => {
                client!.connect(port, process.env.OPENMSX_HOST || '127.0.0.1', async () => {
                    try {
                        await authenticator.performAuth(client!);
                        client!.write('<openmsx-control>\n');
                        isReady = true;
                        logger.debug("ensureRunning(): Connection established.");
                        resolve();
                    } catch (e) { reject(e); }
                });
                client!.on('error', reject);
            });
        })();
        try {
            await initPromise;
        } finally {
            initPromise = null;
        }
    };

    return {
        on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
        ensureRunning,        
        async sendCommand(command: string) {
            await ensureRunning();
            if (!client || client.destroyed) {
                throw new Error("Worker failed to initialize");
            }
            return new Promise((resolve, reject) => {
                const handler = (xmlString: string) => {
                    clearTimeout(timeout);
                    emitter.removeListener('reply', handler);
                    resolve(parseResponse(xmlString));
                };
                const timeout = setTimeout(() => {
                    emitter.removeListener('reply', handler);
                    reject(new Error(`command timed out: ${command}`));
                }, 10000);

                emitter.once('reply', handler);
                client!.write(`<command>${command}</command>\n`);
            });
        }
    };
};