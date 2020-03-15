class Updater {
  constructor({processStream}) {
    this.processStream = processStream;
  }

  applyUpdates(updates) {
    this.processStream.send({
      event: 'moduleUpdate',
      updates
    });
  }
}

module.exports = Updater;
