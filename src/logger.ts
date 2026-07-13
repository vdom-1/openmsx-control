import { McpServer } from "@modelcontextprotocol/server";

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export interface Logger {
  info: (message: string) => Promise<void>;
  warning: (message: string) => Promise<void>;
  error: (message: string) => Promise<void>;
  debug: (message: string) => Promise<void>;
}

export const createLogger = (server: McpServer): Logger => {
  const isDev = process.env.NODE_ENV !== 'production';
  const log = async (message: string, level: LogLevel) => {
    await server.sendLoggingMessage({ level, data: message });
  };
  return {
    info: (message: string) => log(message, 'info'),
    warning: (message: string) => log(message, 'warning'),
    error: (message: string) => log(message, 'error'),
    debug: (message: string) => log(message, 'debug'),
  };
};