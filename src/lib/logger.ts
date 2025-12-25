/**
 * Logger Utility
 * Provides safe logging that only outputs in development mode
 * In production, errors are suppressed or sent to monitoring service
 */

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

const isDevelopment = process.env.NODE_ENV === "development";

export const logger = {
  /**
   * General log - only in development
   */
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * Info log - only in development
   */
  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  /**
   * Warning log - only in development
   */
  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  /**
   * Error log - always logged but sanitized in production
   */
  error: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.error(...args);
    } else {
      // In production, send to monitoring service (e.g., Sentry)
      // For now, just log generic error without details
      console.error("An error occurred. Check monitoring service for details.");
      // TODO: Integrate with Sentry, LogRocket, or similar
      // Sentry.captureException(args[0]);
    }
  },

  /**
   * Debug log - only in development
   */
  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },

  /**
   * Conditional log based on level
   */
  logLevel: (level: LogLevel, ...args: unknown[]): void => {
    if (isDevelopment) {
      console[level](...args);
    }
  },
};
