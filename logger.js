class Logger {
  constructor(options = {}) {
    this.process = options.process;
  }
  error(error) {
    if (!this.process || this.process.connected) {
      console.error(`[${Date.now()}]`, error)
    }
  }
  warn(error) {
    if (!this.process || this.process.connected) {
      console.warn(`[${Date.now()}]`, error);
    }
  }
}

module.exports = Logger;
