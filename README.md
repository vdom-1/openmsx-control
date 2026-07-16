# openmsx-control

> The unopinionated bridge connecting the openMSX emulator with your AI agents.

`openmsx-control` is a lean **Model Context Protocol (MCP) server** designed specifically to expose the openMSX console programmatically to AI agents. 

---

## Core Philosophy

### Unopinionated & Direct
`openmsx-control` exposes just one primary tool: `sendCommand`. 

Instead of trying to wrap every single emulator feature into a massive, fragile library of granular tool calls, openmsx-control exposes just one primary tool: sendCommand.

This approach shifts the burden of understanding the emulator onto the LLM itself, which is already highly capable of navigating CLI syntaxes.

- No Fragile Wrappers: No need to update the MCP server when openMSX adds or changes commands.

- Zero Extraction Overhead: Avoids intermediate parsing, middleware, or proprietary abstractions.

- Uninhibited Agent Autonomy: The agent receives full, raw access to the native emulator console with the flexibility to chain, script, and execute any command exactly like a human developer would.


### Self-Documentation via MCP Resources

To complement the raw `sendCommand` tool, `openmsx-control` exposes a static MCP resource: `sendCommandGuide`.

Instead of bloating the server with a static, hardcoded API manual that quickly goes out of date, this resource acts as a **cognitive kickstart** for the LLM. It guides the agent on how to use the emulator’s native, self-documenting CLI to discover commands and its syntaxe dynamically.

-   Instructs the agent on how to use discovery commands (like `help` or `about`) to explore the active openMSX API on its own.
-   Explains how to perform an action or interface with a specific sub-system and manage variables, configurations, or environmental states.

### Lean & Token-Efficient
Because there is no intermediate processing and the minimal boostrap guid, the implementation remains incredibly lightweight. This minimal footprint ensures negligible token overhead: your agent only pays for the exact console command sent and the raw string response returned by openMSX.

---

## Architecture & Deployment

### Transport Protocols
*   **Local Execution (`stdio`):** Used when the Agent and the MCP server run on the same physical machine.
*   **Remote/Containerized Execution (`HTTP`):** Used when hosting the MCP server inside a container, virtual machine, or remote environment.

>  **Hard Dependency:** The MCP server and the running `openmsx` emulator instance **must** reside on the same operating system/machine. They communicate locally via a socket pipe process attachment.

### Platform Support
*   **Windows:** Fully supported (primary development target).
*   **Linux:** Under development.
*   **macOS:** Not currently on the roadmap (but planned for exploration once Linux support stabilizes).


### Security

Because `openmsx-control` grants the agent raw, uninhibited access to the openMSX console, it inherits the same security profile as any agentic system with CLI execution privileges. 

This powerful access exposes the host system to potential risks, including:
*   **Unintended Script Execution:** AI hallucinations or erratic loops generating unexpected console sequences.
*   **Command Injection / Malicious Inputs:** If your agent processes untrusted external data, a prompt injection attack could coerce the agent into executing destructive commands.

>  **Recommendation:** 
> Do not run this MCP server and your emulator instance directly on your primary host machine without isolation. **Always deploy the `openmsx-control` server and the openMSX emulator together inside a secure sandbox, a dedicated virtual machine, or a containerized environment.** 

Isolating the entire execution environment ensures that any accidental or malicious CLI damage is entirely contained.

---

## Features

### Multi-Instance support 

`openmsx-control` allows your agent to prompt the user to target a specific running emulator instance. 

This makes it easy to hook into an already open, GUI-enabled session. It's incredibly useful if you want to visually monitor, inspect, and debug the agent's real-time physical actions inside the emulator window.

The user can choose the a existing instance or spwan a new one. Once the connection is established the mcp server creates a connection to that instance. The user will only be prompted  again once this connection is terminated.

---

