const fork = require('child_process').fork;
const path = require('path');
const eetase = require('eetase');
const Logger = require('./logger');
const objectAssignDeep = require('object-assign-deep');
const argv = require('minimist')(process.argv.slice(2));

const CWD = process.cwd();
const DEFAULT_IPC_TIMEOUT = 10000;
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

let config = objectAssignDeep({}, defaultConfig, appConfig);

let ipcTimeout = config.ipcTimeout == null ? DEFAULT_IPC_TIMEOUT : config.ipcTimeout;

Object.values(config.modules).forEach((moduleConfig) => {
  if (moduleConfig.logLevel == null) {
    moduleConfig.logLevel = config.defaultLogLevel;
  }
});

let logger = new Logger({
  processType: 'master',
  logLevel: config.defaultLogLevel || 'debug'
});

let moduleList = Object.keys(config.modules).filter(moduleName => !!config.modules[moduleName].modulePath);
let moduleSet = new Set(moduleList);
let dependentMap = {};
let moduleProcesses = {};

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
      moduleConfig.logLevel || 'debug',
      '-t',
      ipcTimeout
    ];
    let moduleProc = fork(WORKER_PATH, process.argv.slice(2).concat(workerArgs), execOptions);
    eetase(moduleProc);
    moduleProc.moduleName = moduleName;
    moduleProc.moduleConfig = moduleConfig;

    (async () => {
      for await (let [error] of moduleProc.listener('error')) {
        logger.error(error);
      }
    })();

    let result;
    try {
      result = await moduleProc.listener('message').once(ipcTimeout);
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
    let [workerHandshake] = result;
    // If module does not specify dependencies, assume it depends on all other modules.
    if (workerHandshake.dependencies == null) {
      // Use Set to guarantee uniqueness.
      moduleProc.dependencies = [...new Set(moduleList.filter(mod => mod !== moduleName))];
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
      // Use Set to guarantee uniqueness.
      moduleProc.dependencies = [...new Set(workerHandshake.dependencies)];
    }

    let targetDependencies = moduleProc.dependencies.map(
      dep => config.redirects[dep] == null ? dep : config.redirects[dep]
    );
    // This accounts for redirects.
    moduleProc.targetDependencies = [...new Set(targetDependencies)];

    for (let dep of moduleProc.dependencies) {
      if (!dependentMap[dep]) {
        dependentMap[dep] = [];
      }
      dependentMap[dep].push(moduleName);
    }
    moduleProcesses[moduleName] = moduleProc;
  }

  let moduleProcNames = Object.keys(moduleProcesses);
  let visitedModulesSet = new Set();
  let modulesWithoutDependencies = [];

  for (let moduleName of moduleProcNames) {
    let moduleProc = moduleProcesses[moduleName];
    moduleProc.dependents = dependentMap[moduleName] || [];
    if (!moduleProc.dependencies.length) {
      modulesWithoutDependencies.push(moduleName);
    }
  }

  let orderedProcNames = [];
  let currentLayer = [...modulesWithoutDependencies];
  let unvisitedModuleSet = new Set(moduleProcNames);

  while (currentLayer.length) {
    let nextLayerSet = new Set();
    for (let moduleName of currentLayer) {
      let moduleProc = moduleProcesses[moduleName];
      let isReady = moduleProc.targetDependencies.every(dep => visitedModulesSet.has(dep));
      if (isReady) {
        orderedProcNames.push(moduleName);
        visitedModulesSet.add(moduleName);
        unvisitedModuleSet.delete(moduleName);
        for (let dependent of moduleProc.dependents) {
          nextLayerSet.add(dependent);
        }
      }
    }
    currentLayer = [...nextLayerSet];
  }

  if (unvisitedModuleSet.size) {
    logger.debug(
      `Identified circular dependencies: ${[...unvisitedModuleSet].join(', ')}`
    );
  }

  // Circular dependencies will be instantiated in any order.
  for (let unvisitedModuleName of unvisitedModuleSet) {
    orderedProcNames.push(unvisitedModuleName);
  }
  logger.debug(
    `Module loading order: ${orderedProcNames.join(', ')}`
  );

  for (let moduleName of orderedProcNames) {
    let moduleProc = moduleProcesses[moduleName];
    moduleProc.send({
      event: 'masterHandshake',
      appConfig: config,
      moduleConfig: moduleProc.moduleConfig,
      dependencies: moduleProc.dependencies,
      dependents: moduleProc.dependents
    });
  }
})();
