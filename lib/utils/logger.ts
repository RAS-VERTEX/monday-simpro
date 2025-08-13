// lib/utils/logger.ts - Consistent logging across the application
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: any;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === "development";

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` | ${JSON.stringify(context)}` : "";
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.isDevelopment) {
      console.log(this.formatMessage("debug", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    console.log(this.formatMessage("info", message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage("warn", message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.formatMessage("error", message, context));
  }

  /**
   * Log sync operation metrics
   */
  syncMetrics(
    operation: string,
    metrics: {
      duration: number;
      itemsProcessed: number;
      errors: number;
      success: boolean;
    }
  ): void {
    const { duration, itemsProcessed, errors, success } = metrics;
    const status = success ? "✅" : "❌";

    this.info(`${status} ${operation} completed`, {
      durationMs: duration,
      itemsProcessed,
      errors,
      avgTimePerItem:
        itemsProcessed > 0 ? Math.round(duration / itemsProcessed) : 0,
    });
  }

  /**
   * Log API request/response for debugging
   */
  apiCall(
    service: string,
    endpoint: string,
    duration: number,
    success: boolean
  ): void {
    const status = success ? "✅" : "❌";
    this.debug(`${status} ${service} API call`, {
      endpoint,
      durationMs: duration,
    });
  }
}

export const logger = new Logger();
