const fork = require('child_process').fork;
const path = require('path');
const eetase = require('eetase');
const Logger = require('./logger');
const argv = require('minimist')(process.argv.slice(2));
const configPath = argv.c;
const config = require(configPath);
const HANDSHAKE_TIMEOUT = 2000;

let logger = new Logger();

let moduleProcesses = {};

const WORKER_PATH = path.join(__dirname, 'worker.js');
const CWD = process.cwd();

let moduleList = Object.keys(config.modules);
let dependentMap = {};

(async () => {
  for (let moduleName of moduleList) {
    let moduleConfig = config.modules[moduleName];
    let modulePath = path.join(CWD, moduleConfig.path);
    let execOptions = {
      env: {...process.env},
      execArgv: process.execArgv,
      cwd: CWD
    };
    let workerArgs = [
      '-n',
      moduleName,
      `-p`,
      modulePath
    ];
    let moduleProc = fork(WORKER_PATH, process.argv.slice(2).concat(workerArgs), execOptions);
    eetase(moduleProc);

    (async () => {
      for await (let [error] of moduleProc.listener('error')) {
        logger.error(error);
      }
    })();

    let result;
    try {
      result = await moduleProc.listener('message').once(HANDSHAKE_TIMEOUT);
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
    let [workerHandshake] = result;
    // If module does not specify dependencies, assume it depends on all other modules.
    if (workerHandshake.dependencies == null) {
      moduleProc.dependencies = moduleList.filter(mod => mod !== moduleName);
    } else {
      moduleProc.dependencies = workerHandshake.dependencies;
    }
    for (let dep of moduleProc.dependencies) {
      if (!dependentMap[dep]) {
        dependentMap[dep] = [];
      }
      dependentMap[dep].push(moduleName);
    }

    moduleProcesses[moduleName] = moduleProc;
  }

  for (let moduleName of moduleList) {
    let moduleProc = moduleProcesses[moduleName];
    moduleProc.send({
      event: 'masterHandshake',
      dependents: dependentMap[moduleName] || []
    });
  }
})();
