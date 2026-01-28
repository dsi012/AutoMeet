"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.screenCapture = void 0;
exports.isAvailable = isAvailable;
// TypeScript bindings for the native ScreenCaptureKit module
const path = require('path');
let nativeModule = null;
try {
    // Try to load the native module
    nativeModule = require(path.join(__dirname, '../build/Release/screencapture.node'));
}
catch (error) {
    console.warn('ScreenCaptureKit native module not available:', error);
}
exports.screenCapture = nativeModule;
function isAvailable() {
    return nativeModule !== null;
}
