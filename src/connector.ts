import net from 'net';
import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { SSPIAuthenticator } from './sspi-authenticator.js';


export interface Connector {
    on: (event: string, listener: (...args: any[]) => void) => void;    
    sendCommand: (command: string) => Promise<string>;
    attachInstance: (port: string) => Promise<void>;
    isConnected: () => boolean;
    getCurrentPort: () => string | null;
}

export const createConnector = (
    logger: Logger, 
    authenticator: SSPIAuthenticator,
): Connector => {
    const emitter = new EventEmitter();
    let client: net.Socket | null = null;
    let currentPort: string | null = null;

    const parseResponse = (xml: string): string => {
        const contentMatch = xml.match(/>([^<]+)<\/reply>/);
        const rawContent = contentMatch ? contentMatch[1] : null;

        const decodeEntities = (str: string | null) => {
            if (!str) return "";
            return str.replace(/&apos;/g, "'").replace(/&#x0a;/g, "\n").replace(/&quot;/g, '"')
                      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        };

        return decodeEntities(rawContent)      
        
    };

    const writeCommand = (command: string): Promise<string> => {
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
            client!.write(`<command>${command}</command>\n`);
        });
    };

    
    return {
        on: (event, listener) => emitter.on(event, listener),

        async attachInstance(portStr: string): Promise<void> {
            const port = parseInt(portStr, 10);            
            if (client && !client.destroyed && currentPort === portStr) return;
            if (client) { client.destroy(); client = null; }
            client = await new Promise<net.Socket>((resolve, reject) => {
                const socket = net.connect(port, '127.0.0.1', async () => {
                    try {
                        await authenticator.performAuth(socket);
                        socket.write('<openmsx-control>\n');
                        resolve(socket);
                    } catch (e) {
                        reject(e);
                    }
                });
                socket.on('data', (data) => {
                    const rawOutput = data.toString();
                    if (rawOutput.includes('</reply>')) emitter.emit('reply', rawOutput);
                });
                socket.on('error', reject);
            });
            currentPort = portStr;
            logger.debug(`[Worker] Successfully attached to port: ${portStr}`);
        },
        
        async sendCommand(input: string): Promise<string> {
            if (!client || client.destroyed) {
                throw new Error("Worker is not connected. Dispatcher must handle re-connection.");
            }
            return writeCommand(input); 
        },

        isConnected: (port?: string) => {
           return !!(client && !client.destroyed && client.writable);
        },

        getCurrentPort: () =>{return currentPort}        

    };
};