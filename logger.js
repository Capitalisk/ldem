class Logger {
  constructor(options = {}) {
    this.process = options.process;
    this.processInfo = options.processType;
    if (this.process) {
      this.processInfo += `,${this.process.pid}`;
    }
  }
  error(error) {
    if (!this.process || this.process.connected) {
      console.error(`[${Date.now()},${this.processInfo}]`, error)
    }
  }
  warn(error) {
    if (!this.process || this.process.connected) {
      console.warn(`[${Date.now()},${this.processInfo}]`, error);
    }
  }
}

module.exports = Logger;
