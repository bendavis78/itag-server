'use strict'
const noble = require('noble');
const request = require('request');
const yaml = require('js-yaml');
const fs = require('fs');
const uuid = require('uuid/v4');

// Button click service: ffe0/ffe1
const KEYPRESS_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const KEYPRESS_SERVICE = 'ffe0';
const KEYPRESS_CHAR = 'ffe1';
const RETRY_TIMEOUT = 3000;

const knownPeripherals = {};
const cycleStates = {};

let actions = yaml.safeLoad(fs.readFileSync('actions.yaml', 'utf8'));

function keyPressed(id) {
  console.log(`${id}: key pressed`);
  let action = actions[id];
  if (!action) {
    console.log(`${id}: no action configured`);
  }
  runAction(id, action);
}

function runAction(id, action) {
  if (action.type === 'cycle') {
    if (!action.id) {
      action.id = uuid();
    }
    let seq = cycleStates[action.id] || 0;
    runAction(id, action.actions[seq]);
    cycleStates[action.id] = (seq + 1) % action.actions.length;
  } else if (action.type === 'sequence') {
    for (let item of action.actions) {
      runAction(id, item);
    }
  } else {
    // default action type is request
    let method = (action.method || 'get').toLowerCase();
    let data = action.data || {};
    request[method](action.url, data)
      .on('response', response => console.log(`${id}: ${action.url} OK`))
      .on('error', err => console.log(`${id}: ERROR: ${err}`));
  }
}

function connect(peripheral) {
  let id = peripheral.id;

  function log(msg) {
    console.log(`${id}: ${msg}`);
  }
  function logError(err) {
    console.error(`${id}: ${err}`);
  }

  log(`connecting...`);
  noble.stopScanning();
  peripheral.connect(error => {
    noble.startScanning();
    if (error) {
      logError(error);
      return retry(peripheral);
    }

    log(`connected.`);

    peripheral.discoverSomeServicesAndCharacteristics([KEYPRESS_SERVICE], [KEYPRESS_CHAR], (error, services, characteristics) => {
      if (error) return logError(error);
      let characteristic = characteristics[0];
      characteristic.subscribe(error => {
        if (error) return logError(error);
        log(`listening...`);
      });
      characteristic.on('data', (data, isNotification) => {
        log(`data: ${data}`);
        if (isNotification) {
          keyPressed(peripheral.id);
        }
      });
    });
  });

  peripheral.once('disconnect', () => {
    log(`disconnected`);
    retry(peripheral);
  });
}

function retry(peripheral) {
  console.log(`${peripheral.id}: retrying in ${RETRY_TIMEOUT/1000} seconds`);
  setTimeout(() => connect(peripheral), RETRY_TIMEOUT);
}

noble.on('stateChange', state => {
  if (state === 'poweredOn') {
    console.log('scanning...');
    noble.startScanning();
  }
});

noble.on('discover', peripheral => {
  if (knownPeripherals[peripheral.id]) {
    return;
  }
  knownPeripherals[peripheral.id] = peripheral;

  if (actions[peripheral.id]) {
    connect(peripheral);
  }
});
