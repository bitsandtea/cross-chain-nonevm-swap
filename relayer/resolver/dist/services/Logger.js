"use strict";
/**
 * Logger service for the resolver
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
const winston_1 = __importDefault(require("winston"));
/**
 * Create a logger instance with the given label
 */
function createLogger(label) {
    const logLevel = process.env.LOG_LEVEL || "info";
    const logFile = process.env.LOG_FILE || "resolver.log";
    return winston_1.default.createLogger({
        level: logLevel,
        format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.label({ label }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
        defaultMeta: { service: "resolver" },
        transports: [
            // Console output
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple(), winston_1.default.format.printf(({ timestamp, level, label, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
                    return `${timestamp} [${label}] ${level}: ${message}${metaStr}`;
                })),
            }),
            // File output
            new winston_1.default.transports.File({
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
exports.logger = createLogger("Resolver");
//# sourceMappingURL=Logger.js.map