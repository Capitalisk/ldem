module.exports = {
  alias: 'one',

  dependencies: [],

  defaults: {},

  events: [],

  actions: [],

  load: async (channel, options) => {
    console.log('Loading module one...');
  },

  unload: async () => {}
};
