import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export interface Logger {
  info: (message: string) => Promise<void>;
  warning: (message: string) => Promise<void>;
  error: (message: string) => Promise<void>;
  debug: (message: string) => Promise<void>;
}

export const createLogger = (server: McpServer): Logger => {
  const isDev = process.env.NODE_ENV !== 'production';
  const emit = async (message: string, level: LogLevel) => {
    await server.sendLoggingMessage({ level, data: message });
    if (isDev) {
      console.error(`[${level.toUpperCase()}] ${message}`);
    }
  };
  return {
    info: (message: string) => emit(message, 'info'),
    warning: (message: string) => emit(message, 'warning'),
    error: (message: string) => emit(message, 'error'),
    debug: (message: string) => emit(message, 'debug'),
  };
};