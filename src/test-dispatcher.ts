import { createLogger } from './logger.js';
import { createSSPIAuthenticator } from './sspi-authenticator.js';
import { createConnector } from './connector.js';
import { createDispatcher } from './dispatcher.js';
import { createInstanceManager } from './instance-manager.js';

const mockServer = {
    sendLoggingMessage: async (msg: any) => {
        // console.log("[LOG]", msg.data);
    }
} as any;

const logger = createLogger(mockServer);
const authenticator = createSSPIAuthenticator(logger);
const instanceManager = createInstanceManager(logger);
const connector = createConnector(logger, authenticator);
const dispatcher = createDispatcher(logger, connector, instanceManager);

async function runTest() {
    console.log("1. Sending initial command 'help'...");
    let response = await dispatcher.sendCommand("help");
    
    if (response.status === 'ELICITATION_REQUIRED') {
        console.log("   Got ELICITATION_REQUIRED. Resolving with NEW...");
        await dispatcher.resolveElicitation('NEW');
        console.log("   Resolved! Sending 'help' again...");
        response = await dispatcher.sendCommand("help");
        console.log("   Response status:", response.status);
    } else {
        console.log("   Initial Response status:", response.status);
    }
    
    console.log("2. Sending second command 'openmsx_info version'...");
    response = await dispatcher.sendCommand("openmsx_info version");
    console.log("   Response status:", response.status);
    if (response.status === 'SUCCESS') {
        console.log("   Version info snippet:", response.content.substring(0, 50));
    }

    console.log("Test completed successfully.");
    process.exit(0);
}

runTest().catch(e => {
    console.error("Test failed:", e);
    process.exit(1);
});
