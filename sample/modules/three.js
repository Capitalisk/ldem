class ThreeModule {
  constructor({alias}) {
    this.alias = alias;
  }

  get dependencies() {
    return ['two', 'special'];
  }

  get events() {
    return [];
  }

  get actions() {
    return {};
  }

  async load(channel, options) {
    console.log(`Module ${this.alias} options:`, options);

    let result = await channel.invoke('special:greeting');
    console.log('REDIRECTED MODULE RESULT:', result);
  }

  async unload() {}
};

module.exports = ThreeModule;
