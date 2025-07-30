/**
 * Logger service for the resolver
 */

import winston from "winston";

/**
 * Create a logger instance with the given label
 */
export function createLogger(label: string): winston.Logger {
  const logLevel = process.env.LOG_LEVEL || "info";
  const logFile = process.env.LOG_FILE || "resolver.log";

  return winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.label({ label }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: "resolver" },
    transports: [
      // Console output
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf(
            ({ timestamp, level, label, message, ...meta }) => {
              const metaStr =
                Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
              return `${timestamp} [${label}] ${level}: ${message}${metaStr}`;
            }
          )
        ),
      }),

      // File output
      new winston.transports.File({
        filename: logFile,
        maxsize: 10485760, // 10MB
        maxFiles: 5,
        tailable: true,
      }),
    ],
  });
}

/**
 * Global logger instance
 */
export const logger = createLogger("Resolver");
