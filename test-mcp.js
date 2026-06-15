import { spawn } from 'child_process';
import readline from 'readline';

const serverProcess = spawn('node', ['C:\\MSX\\WORKSPACE\\openmsx-control\\dist\\server.js'], {
    env: {
        ...process.env,
        OPENMSX_EXE: "C:\\Program Files\\openMSX\\openmsx.exe",
        OPENMSX_DEFAULT: "C:\\Users\\Victor\\AppData\\Local\\Temp\\openmsx-default",
        OPENMSX_HOST: "127.0.0.1"
    }
});

const rl = readline.createInterface({
    input: serverProcess.stdout,
    terminal: false
});

let messageId = 1;

function sendCommand(commandName, args) {
    const request = {
        jsonrpc: "2.0",
        id: messageId++,
        method: "tools/call",
        params: {
            name: commandName,
            arguments: args
        }
    };
    console.log("-> Sending request:", JSON.stringify(request));
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
}

rl.on('line', (line) => {
    try {
        const msg = JSON.parse(line);
        if (msg.method === "notifications/message") {
            // Internal logging
            console.log("<- LOG:", msg.params.data);
            return;
        }
        console.log("<- Received response:", JSON.stringify(msg, null, 2));
        
        if (msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text) {
            const text = msg.result.content[0].text;
            if (text.includes("ELICITATION_REQUIRED")) {
                console.log("\n*** Elicitation detected. Auto-resolving with NEW... ***\n");
                sendCommand("sendCommand", { command: "help" }); // Wait, elicitation is resolved via server.server.elicitInput!
            } else if (text.includes("SUCCESS")) {
                console.log("\n*** Command executed successfully! ***\n");
                serverProcess.kill();
                process.exit(0);
            }
        }

    } catch (e) {
        console.log("<- RAW:", line);
    }
});

// Start by initializing the MCP server
serverProcess.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: messageId++,
    method: "initialize",
    params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
    }
}) + '\n');

setTimeout(() => {
    console.log("\n--- Executing sendCommand ---");
    sendCommand("sendCommand", { command: "help" });
}, 1000);
