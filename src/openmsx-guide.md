## The `sendCommand` tool

Exposes the emulator's TCL(Tool Command Language) interactive REPL(Read-Eval-Print Loop) console. 

*  Every tool call returns both status and content. 
*  Always validate the content in addition to the status. Do not assume the operation succeeded solely because the status indicates success. The content may still contain a failure, error, or additional instructions.
* Before proceeding, inspect the content for indicators of unsuccessful execution, invalid state, partial completion, or any other condition that may require corrective action.

## Auto-Discovery & Documentation

The emulator provides a self-documenting API. You must operate in "auto-discovery mode," which means you are expected to be thorough when navigating the documentation. Explore all possibilities provided by the API before coming to a conclusion, learning dynamically from the following commands:

* `help` provides the list of commands
* `help <command>` (e.g., `help debug`) provides documentation for a ecific command
* `help <command> <subcommand>` (e.g., `help debug read`) provides documentation for a specific subcommand
* `openmsx_info setting`  provides the list of settings
* `help set <setting>` (e.g., `help set power`) provides documentation for a specific setting
* `about <keyword>` (e.g., `about palette`) finds commands and/or settings related to a keyword
* `machine_info` provides the list of information topics related to the current machine
* `openmsx_info` provides the list of information topics related to the emulator

## Sintaxe

### Command syntax

    (use commands to perform an action or interface with a specific sub-system)

* `<command> [arguments]` (e.g.,`carta cart_name.rom` or `reset`)
* `<command> <subcommand> <subcommand> [arguments]` (e.g.,`debug breakpoint create -address 0x4000`) (where `debug` is the command, `breakpoint` is the subcommand, `create` is another subcommand and `-address 0x4000` are the arguments)

### Setting syntax

    (use settings to manage variables, configurations, or environmental states)
    
* `set <setting>` (e.g., `set power`) query the state of a setting
* `set <setting> <value>` (e.g., `set power on`) modify the the state of a setting to the specified value