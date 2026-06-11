'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement() {
  return {
    className: '',
    innerHTML: '',
    classList: { remove() {}, add() {}, toggle() {} },
    appendChild() {},
    querySelector() { return null; },
    remove() {}
  };
}

function assertSupportedCameraConfig(cameraIdOrConfig) {
  assert(cameraIdOrConfig, 'cameraIdOrConfig is required');
  if (typeof cameraIdOrConfig === 'string') return;
  assert.strictEqual(typeof cameraIdOrConfig, 'object', 'cameraIdOrConfig must be a string or object');

  const keys = Object.keys(cameraIdOrConfig);
  assert.strictEqual(keys.length, 1, 'cameraIdOrConfig object must have exactly one key');
  assert(['facingMode', 'deviceId'].includes(keys[0]), 'cameraIdOrConfig only supports facingMode or deviceId');

  if (keys[0] === 'deviceId') {
    const deviceId = cameraIdOrConfig.deviceId;
    if (typeof deviceId === 'string') return;
    assert(deviceId && typeof deviceId === 'object' && typeof deviceId.exact === 'string', 'deviceId must be string or { exact }');
    return;
  }

  const facingMode = cameraIdOrConfig.facingMode;
  if (typeof facingMode === 'string') {
    assert(['user', 'environment'].includes(facingMode), 'facingMode string must be user or environment');
    return;
  }
  assert(facingMode && typeof facingMode === 'object' && typeof facingMode.exact === 'string', 'facingMode must be string or { exact }');
  assert(['user', 'environment'].includes(facingMode.exact), 'facingMode exact must be user or environment');
}

function waitForAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runScenario({ isIOS, isSafari, failRestartOnSameInstance = false }) {
  const startCalls = [];
  const instances = [];
  const handledCodes = [];
  const container = createElement();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback(); },
    navigator: {
      platform: isIOS ? 'iPhone' : 'Win32',
      userAgent: isSafari ? 'Version/17.0 Mobile Safari/605.1.15' : 'Chrome/125.0',
      maxTouchPoints: isIOS ? 5 : 0
    },
    document: {
      getElementById(id) {
        return id === 'scanner-container' || id === 'scan-result-area' ? container : null;
      },
      createElement
    },
    Utils: {
      isIOS() { return isIOS; },
      isSafari() { return isSafari; },
      flashElement() {},
      vibrate() {},
      normalizeBarcode(text) {
        return /^\d{18}$/.test(text) ? text : null;
      }
    },
    App: {
      showToast(message) {
        throw new Error('Unexpected toast: ' + message);
      }
    },
    Html5QrcodeSupportedFormats: { CODE_128: 5 },
    Html5Qrcode: class Html5QrcodeMock {
      constructor() {
        this.stopCount = 0;
        this.clearCount = 0;
        this.isScanning = false;
        instances.push(this);
      }
      async start(cameraIdOrConfig, scanConfig, onSuccess) {
        if (failRestartOnSameInstance && this.stopCount > 0) {
          throw new Error('Cannot restart stopped camera instance');
        }
        assertSupportedCameraConfig(cameraIdOrConfig);
        this.isScanning = true;
        this.onSuccess = onSuccess;
        startCalls.push({ cameraIdOrConfig, scanConfig, instance: this });
      }
      async stop() {
        this.stopCount += 1;
        this.isScanning = false;
      }
      async clear() {
        this.clearCount += 1;
      }
    }
  };

  vm.createContext(context);
  const scannerPath = path.join(__dirname, '..', 'js', 'scanner.js');
  const scannerSource = fs.readFileSync(scannerPath, 'utf8') + '\nglobalThis.Scanner = Scanner;';
  vm.runInContext(scannerSource, context, { filename: scannerPath });

  await context.Scanner.start('scanner-container', (code) => handledCodes.push(code));
  assert.strictEqual(startCalls.length, 1, 'Scanner should start camera on the first supported attempt');
  assert.strictEqual(instances.length, 1, 'Scanner should create one Html5Qrcode instance');
  assert.strictEqual(startCalls[0].cameraIdOrConfig.facingMode, 'environment');

  const scanConfig = startCalls[0].scanConfig;
  assert.strictEqual(scanConfig.fps, isIOS ? 12 : 14);

  const qrbox = scanConfig.qrbox(1000, 800);
  const expectedWidth = Math.floor(800 * (isIOS ? 0.96 : 0.88));
  const expectedHeight = Math.floor(expectedWidth * (isIOS ? 0.3 : 0.48));
  assert.strictEqual(qrbox.width, expectedWidth);
  assert.strictEqual(qrbox.height, expectedHeight);

  if (isIOS) {
    assert.strictEqual(scanConfig.videoConstraints.facingMode, 'environment');
    assert.strictEqual(scanConfig.videoConstraints.width.ideal, 1920);
    assert.strictEqual(scanConfig.videoConstraints.height.ideal, 1080);
  } else {
    assert.strictEqual(scanConfig.videoConstraints, undefined);
  }

  instances[0].onSuccess('123456789012345678');
  await waitForAsyncWork();
  assert.deepStrictEqual(handledCodes, ['123456789012345678']);
  assert.strictEqual(instances[0].stopCount, 1, 'Successful scan should pause camera with stop()');
  assert.strictEqual(instances[0].clearCount, 0, 'Successful scan should not clear scanner instance');

  await context.Scanner.start('scanner-container', () => {});
  if (failRestartOnSameInstance) {
    assert.strictEqual(instances.length, 2, 'Scanner should recreate Html5Qrcode instance when paused instance cannot restart');
    assert.strictEqual(instances[0].clearCount, 1, 'Failed paused instance should be cleared before recreation');
    assert.strictEqual(startCalls.length, 2, 'Scanner should restart with a recreated instance');
    assert.strictEqual(startCalls[1].instance, instances[1], 'Restart should use the recreated instance');
  } else {
    assert.strictEqual(instances.length, 1, 'Scanner should reuse Html5Qrcode instance across restarts');
    assert.strictEqual(startCalls.length, 2, 'Scanner should restart the reused instance');
  }

  await context.Scanner.stop();
  const lastInstance = instances[instances.length - 1];
  assert.strictEqual(lastInstance.clearCount, 1, 'Explicit stop should clear active scanner instance');
}

(async () => {
  await runScenario({ isIOS: false, isSafari: false });
  await runScenario({ isIOS: true, isSafari: true });
  await runScenario({ isIOS: true, isSafari: true, failRestartOnSameInstance: true });
  console.log('scanner start camera config checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
