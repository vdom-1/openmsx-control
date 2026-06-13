import nes from 'node-expose-sspi';
import net from 'net';
import { Logger } from './logger.js';

export interface SSPIAuthenticator {
  performAuth: (socket: net.Socket) => Promise<void>;
}

const createStreamReader = (socket: net.Socket) => {
    let buffer = Buffer.alloc(0);
    const queue: { size: number, resolve: (b: Buffer) => void }[] = [];
    const processQueue = () => {
        while (queue.length > 0 && buffer.length >= queue[0].size) {
            const { size, resolve } = queue.shift()!;
            const chunk = buffer.subarray(0, size);
            buffer = Buffer.from(buffer.subarray(size));
            resolve(chunk);
        }
    };
    const listener = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        processQueue();
    };
    socket.on("data", listener);
    return {
        read: (size: number): Promise<Buffer> => {
            return new Promise((resolve) => {
                queue.push({ size, resolve });
                processQueue();
            });
        },
        cleanup: () => socket.off("data", listener)
    };
};

export const createSSPIAuthenticator = (logger: Logger): SSPIAuthenticator => {
    return {
        performAuth: async (socket: net.Socket): Promise<void> => {
            const reader = createStreamReader(socket);
            try{
                await logger.info("Starting SSPI handshake...");
                const cred = nes.sspi.AcquireCredentialsHandle({ 
                    packageName: 'Negotiate', 
                    credentialUse: 'SECPKG_CRED_OUTBOUND' 
                });
                let contextHandle: any = undefined;
                let serverToken: any = undefined;
                while (true) {
                    const input: any = { 
                        credential: cred.credential, 
                        targetName: '', 
                        contextReq: ['ISC_REQ_ALLOCATE_MEMORY', 'ISC_REQ_CONNECTION', 'ISC_REQ_STREAM'] 
                    };
                    if (contextHandle !== undefined) input.contextHandle = contextHandle;
                    if (serverToken !== undefined) input.SecBufferDesc = serverToken;
                    const clientCtx = nes.sspi.InitializeSecurityContext(input);
                    contextHandle = clientCtx.contextHandle;
                    if (clientCtx.SecBufferDesc?.buffers?.[0]) {
                        const token = Buffer.from(clientCtx.SecBufferDesc.buffers[0]);
                        if (token.length > 0) {
                            const header = Buffer.alloc(4);
                            header.writeUInt32BE(token.length, 0);
                            socket.write(header);
                            socket.write(token);
                        }
                    }
                    if (String(clientCtx.SECURITY_STATUS) === 'SEC_E_OK' || Number(clientCtx.SECURITY_STATUS) === 0) {
                        await logger.info("SSPI Handshake successful");
                        break;
                    }
                    const sizeData = await reader.read(4);
                    const serverResponseToken = await reader.read(sizeData.readUInt32BE(0));            
                    serverToken = { 
                        ulVersion: 0, 
                        buffers: [
                            (serverResponseToken.buffer as ArrayBuffer).slice(
                                serverResponseToken.byteOffset, 
                                serverResponseToken.byteOffset + serverResponseToken.byteLength
                            )
                        ] 
                    };
                }
            }catch(error){
                await logger.error(`SSPI Handshake failed: ${error}`);
            }finally{
                reader.cleanup();
            }
        }
    };
};