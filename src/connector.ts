import net from 'net';
import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { SSPIAuthenticator } from './sspi-authenticator.js';

export interface Connector {
    on: (event: string, listener: (...args: any[]) => void) => void;    
    sendCommand: (command: string, timeoutMs?: number) => Promise<{ result: string; content: string }>;
    establishConnection: (port: string) => Promise<void>;
    isConnected (port: string): Promise<boolean>;
}

export const createConnector = (
    logger: Logger, 
    authenticator: SSPIAuthenticator,
): Connector => {
    const emitter = new EventEmitter();
    let client: net.Socket | null = null;
    const parseResponse = (xml: string): { result: string; content: string } => {
        const contentMatch = xml.match(/<reply\s+result="([^"]+)"[^>]*>([\s\S]*?)<\/reply>/); // />([^<]+)<\/reply>/
        const result = contentMatch ? contentMatch[1] : 'unknown';
        const rawContent = contentMatch ? contentMatch[2] : '';

        const decodeEntities = (str: string) => {            
            return str.replace(/&apos;/g, "'").replace(/&#x0a;/g, "\n").replace(/&quot;/g, '"')
                      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        };
        return {
            result,
            content: decodeEntities(rawContent) 
        }
    };
    
    return {
        on: (event, listener) => emitter.on(event, listener),

        isConnected : (port: string): Promise<boolean> => {
            return new Promise((resolve) => {
                const socket=net.connect(parseInt(port, 10), '127.0.0.1', () => {
                    socket.destroy();
                    resolve(true);
                });
                socket.on('error', () => { resolve(false); });
            });
        }, 

        async establishConnection(portStr: string): Promise<void> {
            const port = parseInt(portStr, 10);            
            if (client && !client.destroyed) {
                if (client.remotePort === port) return;
            }
            if (client) { client.destroy(); client = null; }
            client = await new Promise<net.Socket>((resolve, reject) => {
                const socket = net.connect(port, '127.0.0.1', async () => {
                    try {
                        await authenticator.performAuth(socket);
                        socket.write('<openmsx-control>\n');
                        resolve(socket);
                    } catch (e) {
                        socket.destroy();
                        reject(e);
                    }
                });
                let buffer = '';
                socket.on('data', (chunk) => {
                    buffer += chunk.toString();                    
                    while (buffer.includes('</reply>')) {
                        const endIndex = buffer.indexOf('</reply>') + 8;
                        const message = buffer.substring(0, endIndex);
                        buffer = buffer.substring(endIndex);
                        emitter.emit('reply', message); 
                    }
                });
                socket.on('error', (e) => { buffer = ''; reject(e) });
                socket.on('close', () => { buffer = ''});
            });
            emitter.emit('connected',`Successfully connected to port: ${client.remotePort}`);
        },
        async sendCommand(command: string, timeoutMs: number = 10000): Promise<{ result: string; content: string }> {
            if (!client || client.destroyed) {
                throw new Error("Worker is not connected. Dispatcher must handle re-connection.");
            }

            let handler: (xmlString: string) => void;
            let timer: ReturnType<typeof setTimeout> | undefined;

            // 1. Core operation promise
            const replyPromise = new Promise<{ result: string; content: string }>((resolve) => {
                handler = (xmlString: string) => resolve(parseResponse(xmlString));
                emitter.once('reply', handler);
                emitter.emit('command', `<command>${command}</command>`);
                client!.write(`<command>${command}</command>\n`);
            });

            // 2. Early exit for infinite timeout (0 or negative)
            if (timeoutMs <= 0) {
                return replyPromise;
            }

            // 3. Independent timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Command timed out: ${command}`)), timeoutMs);
            });

            // 4. Centralized execution and house-keeping
            try {
                return await Promise.race([replyPromise, timeoutPromise]);
            } finally {
                // This block ALWAYS runs when the race finishes, cleans up everything in one spot
                emitter.removeListener('reply', handler!);
                if (timer) clearTimeout(timer);
            }
        },

    };
};