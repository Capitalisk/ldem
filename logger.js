const LOG_LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  debug: 3,
  info: 4,
  trace: 5
};

class Logger {
  constructor(options = {}) {
    this.process = options.process;
    this.moduleName = options.moduleName;
    this.processInfo = options.processType;
    if (this.process) {
      this.processInfo += `,${this.process.pid}`;
    }
    if (this.moduleName) {
      this.processInfo += `,${this.moduleName}`;
    }
    this.logLevel = LOG_LEVELS[options.logLevel];
  }

  fatal(error) {
    if (!this.process || this.process.connected) {
      console.error(`[${Date.now()},FATAL,${this.processInfo}]`, error);
    }
  }

  error(error) {
    if (this.logLevel < LOG_LEVELS.error) {
      return;
    }
    if (!this.process || this.process.connected) {
      console.error(`[${Date.now()},ERROR,${this.processInfo}]`, error);
    }
  }

  warn(error) {
    if (this.logLevel < LOG_LEVELS.warn) {
      return;
    }
    if (!this.process || this.process.connected) {
      console.warn(`[${Date.now()},WARN,${this.processInfo}]`, error);
    }
  }

  info(message) {
    if (this.logLevel < LOG_LEVELS.info) {
      return;
    }
    if (!this.process || this.process.connected) {
      console.info(`[${Date.now()},INFO,${this.processInfo}]`, message);
    }
  }

  debug(message) {
    if (this.logLevel < LOG_LEVELS.debug) {
      return;
    }
    if (!this.process || this.process.connected) {
      console.debug(`[${Date.now()},DEBUG,${this.processInfo}]`, message);
    }
  }

  trace(message) {
    if (this.logLevel < LOG_LEVELS.trace) {
      return;
    }
    if (!this.process || this.process.connected) {
      console.trace(`[${Date.now()},TRACE,${this.processInfo}]`, message);
    }
  }
}

module.exports = Logger;
