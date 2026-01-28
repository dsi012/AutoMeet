import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Logger service that writes logs to both console and file
 * Logs are stored in: ~/Library/Logs/meeting-scheduler/app.log (macOS)
 */
export class Logger {
  private logFilePath: string;
  private logStream: fs.WriteStream | null = null;
  private maxLogSize = 10 * 1024 * 1024; // 10MB
  private maxLogFiles = 5; // Keep 5 log files

  constructor() {
    // Determine log directory based on platform
    const logDir = app.getPath('logs'); // ~/Library/Logs/meeting-scheduler on macOS
    
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFilePath = path.join(logDir, 'app.log');
    
    // Rotate logs if current file is too large
    this.rotateLogsIfNeeded();
    
    // Create write stream
    this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    
    this.info(`📝 Logger initialized, logs saved to: ${this.logFilePath}`);
  }

  /**
   * Rotate log files if current log is too large
   */
  private rotateLogsIfNeeded() {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return;
      }

      const stats = fs.statSync(this.logFilePath);
      if (stats.size < this.maxLogSize) {
        return;
      }

      // Close current stream if open
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }

      // Rotate existing log files
      for (let i = this.maxLogFiles - 1; i > 0; i--) {
        const oldPath = i === 1 ? this.logFilePath : `${this.logFilePath}.${i - 1}`;
        const newPath = `${this.logFilePath}.${i}`;
        
        if (fs.existsSync(oldPath)) {
          if (i === this.maxLogFiles - 1) {
            // Delete oldest log
            fs.unlinkSync(oldPath);
          } else {
            // Rename log
            fs.renameSync(oldPath, newPath);
          }
        }
      }

      // Rename current log to .1
      if (fs.existsSync(this.logFilePath)) {
        fs.renameSync(this.logFilePath, `${this.logFilePath}.1`);
      }
    } catch (error) {
      console.error('Error rotating logs:', error);
    }
  }

  /**
   * Format log message with timestamp and level
   */
  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ') : '';
    
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  /**
   * Write to both console and log file
   */
  private writeLog(level: string, consoleMethod: (...args: any[]) => void, message: string, ...args: any[]) {
    // Write to console (original behavior)
    consoleMethod(message, ...args);

    // Write to log file
    this.writeToFile(level, message, ...args);
  }

  /**
   * Write to log file only
   */
  private writeToFile(level: string, message: string, ...args: any[]) {
    if (this.logStream) {
      const formatted = this.formatMessage(level, message, ...args);
      this.logStream.write(formatted + '\n');
    }
  }

  /**
   * Log info message
   */
  info(message: string, ...args: any[]) {
    this.writeLog('INFO', console.log, message, ...args);
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: any[]) {
    this.writeLog('WARN', console.warn, message, ...args);
  }

  /**
   * Log error message
   */
  error(message: string, ...args: any[]) {
    this.writeLog('ERROR', console.error, message, ...args);
  }

  /**
   * Log debug message
   */
  debug(message: string, ...args: any[]) {
    this.writeLog('DEBUG', console.log, message, ...args);
  }

  /**
   * Get log file path
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Get log directory path
   */
  getLogDirectory(): string {
    return path.dirname(this.logFilePath);
  }

  /**
   * Read recent logs (last N lines)
   */
  async getRecentLogs(lines: number = 100): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(this.logFilePath, 'utf-8', (err, data) => {
        if (err) {
          reject(err);
          return;
        }

        const allLines = data.split('\n');
        const recentLines = allLines.slice(-lines);
        resolve(recentLines.join('\n'));
      });
    });
  }

  /**
   * Clear log file
   */
  clearLogs() {
    if (this.logStream) {
      this.logStream.end();
    }

    if (fs.existsSync(this.logFilePath)) {
      fs.unlinkSync(this.logFilePath);
    }

    this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    this.info('📝 Logs cleared');
  }

  /**
   * Close logger (call on app quit)
   */
  close() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

/**
 * Get logger instance
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

/**
 * Replace console methods to also write to file
 * This captures all console.log/warn/error calls throughout the app
 */
export function setupGlobalLogging() {
  const logger = getLogger();
  
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function(...args: any[]) {
    originalLog.apply(console, args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logger['writeToFile']('INFO', message);
  };

  console.warn = function(...args: any[]) {
    originalWarn.apply(console, args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logger['writeToFile']('WARN', message);
  };

  console.error = function(...args: any[]) {
    originalError.apply(console, args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    logger['writeToFile']('ERROR', message);
  };

  // Log uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error.stack || error.message);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}

