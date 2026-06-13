# openMSX-Control

**Control the openMSX emulator with your AI application using the Model Context Protocol.**

The **Model Context Protocol (MCP)** is an open-source standard for connecting AI applications to external systems. `@vdom-1/openmsx-control` implements this standard to provide AI-assisted control for the openMSX emulator.

### Why use this?

### How it works

This server does not "think" or make decisions; rather, it acts as a **translator**.

1. **AI Host:** Receives your intent (e.g., "Load the game Sonic").
2. **MCP Protocol:** Standardizes the request and sends it to this server.
3. **openMSX-Control:** Translates the request into the specific TCL commands that openMSX understands.

### Features

* **Direct Control:** Execute TCL commands directly within the emulator environment.
* **Protocol-First:** Leverages the MCP standard for secure, reliable communication between your AI agent and your local system.
* **Extensible:** Exposes emulator functionality, allowing for everything from simple state management (pause/play) to complex script execution.


### Why this works:

1. **It respects the user's intelligence:** It explains *what* MCP is briefly (using your provided definition) but immediately moves to the *value* (control).
2. **It clears up the "LLM vs. Protocol" confusion:** The "How it works" section explains that the AI is just the *host*, and your server is the *translator*. This protects you from users assuming the AI is "doing the emulator work"—it clarifies that the AI is simply sending instructions.
3. **It sounds high-quality:** By using terms like "Bridge," "Translator," and "Command Center," you position your tool as a utility rather than an experimental script.

## Prerequisites

* **OS:** Windows (currently Windows-only support).
* **Runtime:** Node.js v18 or higher.
* **Emulator:** [openMSX](https://openmsx.org/) must be installed on your machine.

## Configuration

To use this server with an MCP-compliant client (like Claude Desktop or VSCode), add it to your configuration file (e.g., `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "openmsx": {
      "command": "npx",
      "args": ["-y", "@vdom-1/openmsx-control"],
      "env": {
        "OPENMSX_EXE": "C:\\path\\to\\openmsx.exe",
        "OPENMSX_DEFAULT": "C:\\path\\to\\openmsx\\share"
      }
    }
  }
}

```

*Note: Update the `env` paths to match your local installation of openMSX.*

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.