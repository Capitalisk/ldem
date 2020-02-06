const fork = require('child_process').fork;
const path = require('path');
const eetase = require('eetase');
const Logger = require('./logger');
const argv = require('minimist')(process.argv.slice(2));

const CWD = process.cwd();
const HANDSHAKE_TIMEOUT = 2000;
const WORKER_PATH = path.join(__dirname, 'worker.js');
const CONFIG_PATH = path.join(CWD, argv.c);

const defaultConfig = require('./config/default.json');
const appConfig = require(CONFIG_PATH);

Object.values(defaultConfig.modules).forEach((moduleConfig) => {
  if (moduleConfig.modulePath != null) {
    moduleConfig.modulePath = path.join(__dirname, moduleConfig.modulePath);
  }
});

Object.values(appConfig.modules).forEach((moduleConfig) => {
  if (moduleConfig.modulePath != null) {
    moduleConfig.modulePath = path.join(CWD, moduleConfig.modulePath);
  }
});

let config = {
  ...defaultConfig,
  ...appConfig,
  redirects: {
    ...defaultConfig.redirects,
    ...appConfig.redirects
  },
  modules: {
    ...defaultConfig.modules,
    ...appConfig.modules
  }
};

Object.values(config.modules).forEach((moduleConfig) => {
  if (moduleConfig.logLevel == null) {
    moduleConfig.logLevel = config.defaultLogLevel;
  }
});

let logger = new Logger({
  processType: 'master'
});
let moduleProcesses = {};

let moduleList = Object.keys(config.modules).filter(moduleName => !!config.modules[moduleName].modulePath);
let moduleSet = new Set(moduleList);
let dependentMap = {};

(async () => {
  for (let moduleName of moduleList) {
    let moduleConfig = config.modules[moduleName];
    let execOptions = {
      env: {...process.env},
      execArgv: process.execArgv,
      cwd: CWD
    };
    let workerArgs = [
      '-n',
      moduleName,
      `-p`,
      moduleConfig.modulePath,
      '-l',
      moduleConfig.logLevel || 'debug'
    ];
    let moduleProc = fork(WORKER_PATH, process.argv.slice(2).concat(workerArgs), execOptions);
    eetase(moduleProc);
    moduleProc.moduleConfig = moduleConfig;

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
        let targetDependencyName;
        if (config.redirects[dependencyName] == null) {
          targetDependencyName = dependencyName;
        } else {
          targetDependencyName = config.redirects[dependencyName];
        }
        if (!moduleSet.has(targetDependencyName)) {
          let error = new Error(
            `Could not find the ${dependencyName} dependency target required by the ${moduleName} module`
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

  let moduleProcNames = Object.keys(moduleProcesses);
  for (let moduleName of moduleProcNames) {
    let moduleProc = moduleProcesses[moduleName];
    moduleProc.send({
      event: 'masterHandshake',
      appConfig: config,
      moduleConfig: moduleProc.moduleConfig,
      dependencies: moduleProc.dependencies,
      dependents: dependentMap[moduleName] || []
    });
  }
})();
