const path = require('path');
const LDEM = require('./index');
const argv = require('minimist')(process.argv.slice(2));

const CWD = process.cwd();
const CONFIG_PATH = path.join(CWD, argv.c);

const config = require(CONFIG_PATH);

new LDEM({
  config
});
