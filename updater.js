class Updater {
  constructor({processStream, updates, activeUpdate}) {
    this.processStream = processStream;
    this.updates = updates;
    this.activeUpdate = activeUpdate;
  }

  activateUpdate(update) {
    this.processStream.send({
      event: 'activateUpdate',
      update
    });
  }

  mergeActiveUpdate() {
    this.processStream.send({
      event: 'mergeActiveUpdate'
    });
    delete this.activeUpdate;
  }

  revertActiveUpdate() {
    this.processStream.send({
      event: 'revertActiveUpdate'
    });
  }
}

module.exports = Updater;
