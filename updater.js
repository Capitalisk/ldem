class Updater {
  constructor({processStream}) {
    this.processStream = processStream;
  }

  applyUpdates(updates) {
    if (updates.length) {
      this.processStream.send({
        event: 'moduleUpdate',
        updates
      });
    }
  }
}

module.exports = Updater;
