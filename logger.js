const fs = require('fs');
const path = require('path');
const promisify = require('util').promisify;
const writeFile = promisify(fs.writeFile);
const mkdirSync = fs.mkdirSync;

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
    this.logFileName = options.logFileName;
    this.fileLoggingEnabled = options.fileLoggingEnabled;
    if (this.fileLoggingEnabled) {
      let logDir = path.dirname(path.resolve(this.logFileName));
      try {
        mkdirSync(logDir, {recursive: true});
      } catch (error) {
        throw new Error(
          `Failed to create log directory ${
            logDir
          } because of error ${
            error.message
          }`
        );
      }
    }
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

  async _logToFile(message) {
    try {
      await writeFile(this.logFileName, `${message}\n`, {flag: 'a'});
    } catch (error) {
      throw new Error(
        `Failed to write to log file at path ${
          this.logFileName
        } because of error ${
          error.message
        }`
      );
    }
  }

  _sanitizeLogEntry(entry) {
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
  }

  _logJSON(type, entries) {
    if (this.processStream.connected || this.isMasterProcess) {
      let logPacket = {
        timestamp: Date.now(),
        type,
        processType: this.processType,
        processId: this.processId,
        processAlias: this.processAlias,
        entries: entries.map(entry => this._sanitizeLogEntry(entry))
      };
      let output = JSON.stringify(logPacket);
      let methodName = type === 'fatal' ? 'error' : type;
      console[methodName].call(console, output);
      if (this.fileLoggingEnabled) {
        this._logToFile(output);
      }
    }
  }

  _logText(type, entries) {
    if (this.processStream.connected || this.isMasterProcess) {
      let header = `[${Date.now()},${type.toUpperCase()},${this.processInfo}]`;
      let sanitizedEntries = entries.map(entry => this._sanitizeLogEntry(entry));
      let output = [header].concat(sanitizedEntries);
      let methodName = type === 'fatal' ? 'error' : type;
      console[methodName].apply(console, output);
      if (this.fileLoggingEnabled) {
        this._logToFile(
          [header].concat(sanitizedEntries.map(part => JSON.stringify(part))).join(' ')
        );
      }
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
