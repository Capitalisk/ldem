const fork = require('child_process').fork;
const path = require('path');
const eetase = require('eetase');
const Logger = require('./logger');
const argv = require('minimist')(process.argv.slice(2));
const configPath = argv.c;

const CWD = process.cwd();
const HANDSHAKE_TIMEOUT = 2000;
const WORKER_PATH = path.join(__dirname, 'worker.js');
const CONFIG_PATH = path.join(CWD, configPath);

const config = require(CONFIG_PATH);

let logger = new Logger();
let moduleProcesses = {};

let moduleList = Object.keys(config.modules);
let moduleSet = new Set(moduleList);
let dependentMap = {};

(async () => {
  for (let moduleName of moduleList) {
    let moduleConfig = config.modules[moduleName];
    let modulePath = path.join(CWD, moduleConfig.modulePath);
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
      for (let dependencyName of workerHandshake.dependencies) {
        if (!moduleSet.has(dependencyName)) {
          let error = new Error(
            `Could not find a dependency ${dependencyName} required by the ${moduleName} module`
          );
          logger.error(error);
          process.exit(1);
        }
      }
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
      dependencies: moduleProc.dependencies,
      dependents: dependentMap[moduleName] || []
    });
  }
})();
