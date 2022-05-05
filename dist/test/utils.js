"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIdlAddress = exports.getProgramDataAddress = exports.promiseWithTimeout = exports.sleep = exports.DEFAULT_PUBKEY = void 0;
const web3_js_1 = require("@solana/web3.js");
const pubkey_1 = require("@project-serum/anchor/dist/cjs/utils/pubkey");
exports.DEFAULT_PUBKEY = new web3_js_1.PublicKey("11111111111111111111111111111111");
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
exports.sleep = sleep;
async function promiseWithTimeout(ms, promise, timeoutError = new Error("timeoutError")) {
    // create a promise that rejects in milliseconds
    const timeout = new Promise((_, reject) => {
        setTimeout(() => {
            reject(timeoutError);
        }, ms);
    });
    return Promise.race([promise, timeout]);
}
exports.promiseWithTimeout = promiseWithTimeout;
const getProgramDataAddress = (programId) => {
    return (0, pubkey_1.findProgramAddressSync)([programId.toBytes()], new web3_js_1.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0];
};
exports.getProgramDataAddress = getProgramDataAddress;
const getIdlAddress = async (programId) => {
    const base = (await web3_js_1.PublicKey.findProgramAddress([], programId))[0];
    return web3_js_1.PublicKey.createWithSeed(base, "anchor:idl", programId);
};
exports.getIdlAddress = getIdlAddress;
//# sourceMappingURL=utils.js.map