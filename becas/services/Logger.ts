import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format (pretty print)
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    (info) => `${info.timestamp} [${info.level}]: ${info.message}${info.stack ? '\n' + info.stack : ''}`
  )
);

// Define transports
const transports = [
  // Console output
  new winston.transports.Console({
    format: consoleFormat,
  }),

  // Error logs - separate file
  new DailyRotateFile({
    filename: path.join('logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: '30d',
    maxSize: '20m',
    format,
  }),

  // Combined logs - all levels
  new DailyRotateFile({
    filename: path.join('logs', 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    maxSize: '20m',
    format,
  }),

  // Performance logs - for metrics
  new DailyRotateFile({
    filename: path.join('logs', 'performance-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'http',
    maxFiles: '7d',
    maxSize: '20m',
    format,
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports,
  exitOnError: false,
});

// Create specialized loggers
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private log(level: string, message: string, meta?: any) {
    logger.log(level, `[${this.context}] ${message}`, meta);
  }

  error(message: string, error?: Error | any) {
    this.log('error', message, { error: error?.message, stack: error?.stack });
  }

  warn(message: string, meta?: any) {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: any) {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: any) {
    this.log('debug', message, meta);
  }

  http(message: string, meta?: any) {
    this.log('http', message, meta);
  }

  // Performance logging
  performance(operation: string, duration: number, success: boolean, meta?: any) {
    this.log('http', `Performance: ${operation}`, {
      duration,
      success,
      ...meta,
    });
  }

  // Moderation action logging
  moderation(action: string, userId: string, reason: string, meta?: any) {
    this.log('info', `Moderation: ${action} on ${userId}`, {
      action,
      userId,
      reason,
      ...meta,
    });
  }

  // AI call logging
  aiCall(model: string, prompt: string, duration: number, success: boolean, tokens?: number) {
    this.log('http', `AI Call: ${model}`, {
      model,
      promptLength: prompt.length,
      duration,
      success,
      tokens,
    });
  }
}

// Export singleton instance
export const createLogger = (context: string) => new Logger(context);

export default logger;
