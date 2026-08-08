import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';

const isVerbose = String(process.env.VERBOSE_LOGGING).trim().toLowerCase() === "true";

const transport = new winston.transports.DailyRotateFile({
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level.toUpperCase()}] : ${message} `;
  if (Object.keys(metadata).length > 0) {
    msg += JSON.stringify(metadata);
  }
  return msg;
});

const winstonLogger = winston.createLogger({
  level: isVerbose ? 'verbose' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    logFormat
  ),
  transports: [
    transport,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
          let msg = `${timestamp} [${level}] : ${message} `;
          if (Object.keys(metadata).length > 0) {
            msg += JSON.stringify(metadata);
          }
          return msg;
        })
      )
    })
  ]
});

// Utility to stringify args
function formatArgs(args: any[]) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    return JSON.stringify(a);
  }).join(' ');
}

export const logger = {
  info: (...args: any[]) => {
    winstonLogger.info(formatArgs(args));
  },
  warn: (...args: any[]) => {
    winstonLogger.warn(formatArgs(args));
  },
  error: (...args: any[]) => {
    winstonLogger.error(formatArgs(args));
  },
  verbose: (...args: any[]) => {
    winstonLogger.verbose(formatArgs(args));
  },
  // Alias for backward compatibility if needed
  log: (...args: any[]) => {
    winstonLogger.info(formatArgs(args));
  }
};
