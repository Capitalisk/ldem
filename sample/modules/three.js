class ThreeModule {
  constructor({alias}) {
    this.alias = alias;
  }

  get dependencies() {
    return ['two'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {};
  }

  async load(channel, options) {
    console.log(`Module ${this.alias} options:`, options);
  }

  async unload() {}
};

module.exports = ThreeModule;
