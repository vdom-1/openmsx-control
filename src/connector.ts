import net from 'net';
import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { SSPIAuthenticator } from './sspi-authenticator.js';

export interface Connector {
    on: (event: string, listener: (...args: any[]) => void) => void;    
    sendCommand: (command: string) => Promise<{ result: string; content: string }>;
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

    const writeCommand = (command: string): Promise<{ result: string; content: string }> => {
        return new Promise((resolve, reject) => {
            const handler = (xmlString: string) => {
                clearTimeout(timeout);
                emitter.removeListener('reply', handler);
                resolve(parseResponse(xmlString));
            };
            const timeout = setTimeout(() => {
                emitter.removeListener('reply', handler);
                reject(new Error(`Command timed out: ${command}`));
            }, 10000);
            emitter.once('reply', handler);
            emitter.emit('command', `<command>${command}</command>`)
            client!.write(`<command>${command}</command>\n`);
        });
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
        
        async sendCommand(input: string): Promise<{ result: string; content: string }> {
            if (!client || client.destroyed) {
                throw new Error("Worker is not connected. Dispatcher must handle re-connection.");
            }
            return writeCommand(input); 
        },

    };
};