class Updater {
  constructor({processStream}) {
    this.processStream = processStream;
  }

  applyUpdates(updates) {
    this.processStream.send({
      event: 'moduleUpdates',
      updates
    });
  }

  notifyUpdatesFailure(updates, reason) {
    this.processStream.send({
      event: 'moduleUpdatesFailure',
      updates,
      reason
    });
  }
}

module.exports = Updater;
