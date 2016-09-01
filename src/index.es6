import ApiBuilder from 'claudia-api-builder';
import Promise from 'any-promise';
import crypto from 'crypto';
import Memcached from 'memcached';
import defaults from 'lodash.defaults';
import readFile from './readFile';
import range from 'lodash.range';

const API = function(mcHosts, dateInstance) {
  const api = new ApiBuilder();
  const mc = Promise.promisifyAll(new Memcached(mcHosts));
  const TS_WINDOW = 300; // allow 5-minute window
  const TTL_GRACE = 15; // 15-second grace period to check-in

  const heartbeatCoordinator = (coordinatorId, mcPrefix, ttl) => {
    console.log('heartbeatCoordinator()');
    return getCoordinationForCoordinatorId(coordinatorId, mcPrefix).then(coordination => {
      if (coordination === false || coordination === undefined) {
        return null;
      }
      let crossCheckCoordinationQ;
      if (coordination.machineId) {
        crossCheckCoordinationQ = getCoordinatorIdForMachineId(coordination.machineId, mcPrefix).then(coordinatorIdCheck => {
          if (coordinatorIdCheck === coordinatorId) {
            return heartbeatMachineIdCoordinator(coordination.machineId, coordinatorId, mcPrefix, ttl).then(() => {
              return coordination;
            });
          }
          return null;
        });
      } else if (coordination.workerId && coordination.datacenterId) {
        crossCheckCoordinationQ = getCoordinatorIdForWorker(coordination.datacenterId, coordination.workerId, mcPrefix).then(coordinatorIdCheck => {
          if (coordinatorIdCheck === coordinatorId) {
            return heartbeatWorkerIdCoordinator(coordination.machineId, coordinatorId, mcPrefix, ttl).then(() => {
              return coordination;
            });
          }
          return null;
        });
      }
      return crossCheckCoordinationQ
    })
  };

  const findAvailableWorkerId = (datacenterId, workerIdMask, mcPrefix, ttl, coordinatorId) => {
    console.log('findAvailableWorkerId()');
    let counter = 0;
    let randomOffset = Math.floor(Math.random() * workerIdMask);
    const incrementCounter = Promise.method(() => {
      return counter++;
    });

    const checkAvailability = () => {
      return incrementCounter().then((counter) => {
        var workerId = (((counter + randomOffset) % workerIdMask) + 1) & workerIdMask;
        return addCoordinatorIdForWorker(coordinatorId, datacenterId, workerId, mcPrefix, ttl).then(coordination => {
          if (coordination !== false) {
            return coordination;
          } else if (counter >= workerIdMask) {
            return Promise.reject();
          } else {
            return checkAvailability();
          }
        })
      })
    };
    return checkAvailability();
  };

  const findAvailableMachineId = (machineIdMask, mcPrefix, ttl, coordinatorId) => {
    console.log('findAvailableMachineId()');
    let counter = 0;
    let randomOffset = Math.floor(Math.random() * machineIdMask);
    const incrementCounter = Promise.method(() => {
      return counter++;
    });

    const checkAvailability = () => {
      return incrementCounter().then((counter) => {
        var machineId = (((counter + randomOffset) % machineIdMask) + 1) & machineIdMask;
        return addCoordinatorIdForMachine(coordinatorId, machineId, mcPrefix, ttl).then(coordination => {
          if (coordination !== false) {
            return coordination;
          } else if (counter >= machineIdMask) {
            return Promise.reject();
          } else {
            return checkAvailability();
          }
        })
      })
    };
    return checkAvailability();
  };

  const getCoordinationForCoordinatorId = (coordinatorId, mcPrefix) => {
    console.log('getCoordinationForCoordinatorId()');
    let coordinatorCacheKey = mcPrefix + "coordinatorId:" + coordinatorId;
    return mc.getAsync(coordinatorCacheKey);
  };

  const getCoordinatorIdForMachineId = (machineId, mcPrefix) => {
    console.log('getCoordinatorIdForMachineId()');
    let machineIdCacheKey = mcPrefix + "machineId:" + machineId;
    return mc.getAsync(machineIdCacheKey);
  };

  const addCoordinatorIdForMachine = (coordinatorId, machineId, mcPrefix, ttl) => {
    console.log('addCoordinatorIdForMachine()');
    let machineIdCacheKey = mcPrefix + "machineId:" + machineId;
    return mc.addAsync(machineIdCacheKey, coordinatorId, ttl + TTL_GRACE).then(added => {
      let coordinatorCacheKey = mcPrefix + "coordinatorId:" + coordinatorId;
      let coordination = {machineId: machineId};
      return mc.setAsync(coordinatorCacheKey, coordination, ttl + TTL_GRACE).then(() => {
        return coordination;
      });
    }).catch(err => {
      return false;
    });
  };
  const getCoordinatorIdForWorker = (datacenterId, workerId, mcPrefix) => {
    console.log('getCoordinatorIdForWorker()');
    let workerIdCacheKey = mcPrefix + "datacenterId:" + datacenterId + "|" + "workerId:" + workerId;
    console.log(workerIdCacheKey);
    return mc.getAsync(workerIdCacheKey);
  };

  const addCoordinatorIdForWorker = (coordinatorId, datacenterId, workerId, mcPrefix, ttl) => {
    console.log('addCoordinatorIdForWorker()');
    let workerIdCacheKey = mcPrefix + "datacenterId:" + datacenterId + "|" + "workerId:" + workerId;
    console.log(workerIdCacheKey);
    return mc.addAsync(workerIdCacheKey, coordinatorId, ttl + TTL_GRACE).then(added => {
      let coordinatorCacheKey = mcPrefix + "coordinatorId:" + coordinatorId;
      let coordination = {datacenterId: datacenterId, workerId: workerId};
      console.log(coordinatorCacheKey);
      return mc.setAsync(coordinatorCacheKey, coordination, ttl + TTL_GRACE).then(res => {
        return coordination;
      });
    }).catch(err => {
      return false;
    });
  };

  const heartbeatMachineIdCoordinator = (machineId, coordinatorId, mcPrefix, ttl) => {
    console.log('heartbeatMachineIdCoordinator()');
    let machineIdCacheKey = mcPrefix + "machineId:" + machineId;
    let coordinatorCacheKey = mcPrefix + "coordinatorId:" + coordinatorId;

    return Promise.all([
      mc.touch(coordinatorCacheKey, ttl + TTL_GRACE),
      mc.touch(machineIdCacheKey, ttl + TTL_GRACE),
    ]);
  };

  const heartbeatWorkerIdCoordinator = (datacenterId, workerId, coordinatorId, mcPrefix, ttl) => {
    console.log('heartbeatWorkerIdCoordinator()');
    let workerIdCacheKey = mcPrefix + "datacenterId:" + datacenterId + "|" + "workerId:" + workerId;
    let coordinatorCacheKey = mcPrefix + "coordinatorId:" + coordinatorId;

    return Promise.all([
      mc.touch(coordinatorCacheKey, ttl + TTL_GRACE),
      mc.touch(workerIdCacheKey, ttl + TTL_GRACE),
    ]);
  };

  api.post('/speck/coordinator', request => {
    const env = request.env.lambdaVersion;
    let coordinatorId = request.body.coordinatorId;

    let options = Object.assign({}, request.body.options);
    defaults(options, {
      appId: null,
      heartbeatTtl: 60000,
      datacenterId: null,
      workerIdMask: null,
      machineIdMask: null,
    });
    let req = Object.assign({}, request.body.request);
    defaults(req, {
      nonce: null,
      ts: null,
      coordination: null,
      env: null,
    });
    let signature = request.body.signature;

    let appId = options.appId;
    let heartbeatTtl = options.heartbeatTtl || 60000; // 1 minute
    heartbeatTtl = heartbeatTtl / 1000; // milliseconds to seconds
    let datacenterId = options.datacenterId || null;
    let workerIdMask = options.workerIdMask;
    let machineIdMask = options.machineIdMask;

    let reqNonce = req.nonce;
    let reqTs = req.ts;
    let reqPreviousCoordination = Object.assign({}, req.coordination);
    let reqEnv = req.env;

    // setup a memcache prefix for this environment
    let mcEnvAppPrefix = "env:" + env + "|";
    if (reqEnv) {
      mcEnvAppPrefix += "reqEnv:" + reqEnv + "|";
    }
    mcEnvAppPrefix += "appId:" + appId + "|";

    // validate body request against signature for the provided appId
    //   get the public key associated with this appId, check memcache first, else read-through-cache from disk
    let appPublicKeyCacheKey = mcEnvAppPrefix + "publicKey";
    return mc.getAsync(appPublicKeyCacheKey).then(publicKey => {
      if (publicKey === false || publicKey === undefined) {
        publicKey = readFile('@dwell/speck-coordinator-apps/keys/public/' + appId + '.pem');
        if (publicKey === undefined) {
          return Promise.reject("HTTP_UNAUTHORIZED Invalid appId");
        }
        publicKey = publicKey.toString('utf8');
        return mc.setAsync(appPublicKeyCacheKey, publicKey, 0).then(() => {
          return publicKey;
        });
      }
      return publicKey;
    }).then(publicKey => {
      //   make sure the nonce hasn't been used yet
      let nonceCheckCacheKey = mcEnvAppPrefix + "nonce:" + reqNonce;
      return mc.getAsync(nonceCheckCacheKey).then(nonce => {
        if (nonce === false || nonce === undefined) {
          return mc.setAsync(nonceCheckCacheKey, 1, heartbeatTtl + TTL_GRACE).then(() => {
            return publicKey;
          });
        }
        return Promise.reject("HTTP_BAD_REQUEST nonce already used");
      });
    }).then(publicKey => {
        //   make sure the timestamp provided is within reason
        if (Math.abs(reqTs - dateInstance.now()) > TS_WINDOW * 1000) {
          return Promise.reject("HTTP_BAD_REQUEST Request timestamp is skewed too far");
        }

        const cryptoVerify = crypto.createVerify('sha256');
        cryptoVerify.update(JSON.stringify(request.body.request));

        if (!cryptoVerify.verify(publicKey, signature, 'hex')) {
          return Promise.reject('HTTP_BAD_REQUEST Signature failed');
        }
    }).then(() => {
      // TODO

      let responseObject = {};
      return Promise.resolve().then(() => {
        if (reqPreviousCoordination && reqPreviousCoordination.machineId) {
          return getCoordinatorIdForMachineId(reqPreviousCoordination.machineId).then(mcCoordinatorId => {
            if (mcCoordinatorId !== false && mcCoordinatorId !== undefined && mcCoordinatorId === coordinatorId) {
              return heartbeatMachineIdCoordinator(reqPreviousCoordination.machineId, coordinatorId, mcEnvAppPrefix, heartbeatTtl).then(() => {
                return reqPreviousCoordination;
              })
            }
            return null;
          }).catch(err => {
            return null;
          });
        }
        return null;
      }).then(coordination => {
        if (coordination !== null) {
          return coordination;
        }
        if (datacenterId && workerIdMask && reqPreviousCoordination.workerId) {
          return getCoordinatorIdForWorker(datacenterId, reqPreviousCoordination.workerId, mcEnvAppPrefix).then(mcCoordinatorId => {
            console.log(mcCoordinatorId);
            if (mcCoordinatorId === coordinatorId) {
              return heartbeatWorkerIdCoordinator(datacenterId, reqPreviousCoordination.workerId, coordinatorId, mcEnvAppPrefix, heartbeatTtl).then(() => {
                return reqPreviousCoordination;
              });
            }
            return null;
          });
        }
        return null;
      }).then(coordination => {
        if (coordination !== null) {
          return coordination;
        }
        // check if there is a previous coordination setup for this coordinatorId
        return heartbeatCoordinator(coordinatorId, mcEnvAppPrefix, heartbeatTtl);
      }).then(coordination => {
        if (coordination !== null) {
          return coordination;
        }
        if (datacenterId && workerIdMask) {
          return findAvailableWorkerId(datacenterId, workerIdMask, mcEnvAppPrefix, heartbeatTtl, coordinatorId);
        }
        return null;
      }).then(coordination => {
        if (coordination !== null) {
          return coordination;
        }
        return findAvailableMachineId(machineIdMask, mcEnvAppPrefix, heartbeatTtl, coordinatorId);
      });
    }).then(coordination => {
      console.log(coordination);
      console.log(coordinatorId);
      return coordination;
    });
  }, {
    success: {contentType: 'application/json'},
    error: {code: 409},
  });

  return api;
};

export default API;

export {
  API
}

