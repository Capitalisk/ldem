class Logger {
  error(error) {
    console.error(`[${Date.now()}]`, error)
  }
  warn(error) {
    console.warn(`[${Date.now()}]`, error);
  }
}

module.exports = Logger;
