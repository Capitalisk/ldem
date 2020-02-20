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
    this.outputType = options.outputType || 'text';
    this.processAlias = options.processAlias || 'ldem';
    this.isMasterProcess = options.processType === 'master';
    this.processType = options.processType;
    this.processStream = options.processStream;
    this.processId = this.processStream.pid;
    this.processInfo = this.processType;
    this.processInfo += `,${this.processId}`;
    if (this.processAlias) {
      this.processInfo += `,${this.processAlias}`;
    }
    this.consoleLogLevel = LOG_LEVELS[options.consoleLogLevel];

    if (this.outputType === 'json') {
      this._log = this._logJSON;
    } else {
      this._log = this._logText;
    }
  }

  _logJSON(type, entries) {
    if (this.processStream.connected || this.isMasterProcess) {
      let logPacket = {
        timestamp: Date.now(),
        type,
        processType: this.processType,
        processId: this.processId,
        processAlias: this.processAlias,
        entries: entries.map(entry => {
          if (!entry || !entry.message) {
            return entry;
          }
          let sanitizedEntry = {};
          sanitizedEntry.name = entry.name;
          sanitizedEntry.message = entry.message;
          if (entry.stack) {
            sanitizedEntry.stack = entry.stack;
          }
          return sanitizedEntry;
        })
      };
      let methodName = type === 'fatal' ? 'error' : type;
      console[methodName].call(console, JSON.stringify(logPacket));
    }
  }

  _logText(type, entries) {
    if (this.processStream.connected || this.isMasterProcess) {
      let methodName = type === 'fatal' ? 'error' : type;
      console[methodName].apply(console, [`[${Date.now()},${type.toUpperCase()},${this.processInfo}]`].concat(entries));
    }
  }

  fatal(...args) {
    this._log('fatal', args);
  }

  error(...args) {
    if (this.consoleLogLevel < LOG_LEVELS.error) {
      return;
    }
    this._log('error', args);
  }

  warn(...args) {
    if (this.consoleLogLevel < LOG_LEVELS.warn) {
      return;
    }
    this._log('warn', args);
  }

  info(...args) {
    if (this.consoleLogLevel < LOG_LEVELS.info) {
      return;
    }
    this._log('info', args);
  }

  debug(...args) {
    if (this.consoleLogLevel < LOG_LEVELS.debug) {
      return;
    }
    this._log('debug', args);
  }

  trace(...args) {
    if (this.consoleLogLevel < LOG_LEVELS.trace) {
      return;
    }
    this._log('trace', args);
  }
}

module.exports = Logger;
