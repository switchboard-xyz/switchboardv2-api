"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.programWallet = exports.createMint = exports.signTransactions = exports.packTransactions = exports.packInstructions = exports.sendAll = exports.BufferRelayerAccount = exports.VrfAccount = exports.OracleAccount = exports.CrankAccount = exports.CrankRow = exports.LeaseAccount = exports.OracleQueueAccount = exports.PermissionAccount = exports.SwitchboardPermissionValue = exports.SwitchboardPermission = exports.JobAccount = exports.AggregatorAccount = exports.AggregatorHistoryRow = exports.SwitchboardError = exports.ProgramStateAccount = exports.SwitchboardDecimal = exports.loadSwitchboardProgram = exports.getSwitchboardPid = exports.GOVERNANCE_PID = exports.SBV2_MAINNET_PID = exports.SBV2_DEVNET_PID = exports.OracleJob = void 0;
const anchor = __importStar(require("@project-serum/anchor"));
const spl = __importStar(require("@solana/spl-token"));
const web3_js_1 = require("@solana/web3.js");
const switchboard_api_1 = require("@switchboard-xyz/switchboard-api");
const big_js_1 = __importDefault(require("big.js"));
const crypto = __importStar(require("crypto"));
const spl_governance_1 = require("@solana/spl-governance");
const nodewallet_1 = __importDefault(require("@project-serum/anchor/dist/cjs/nodewallet"));
var assert = require("assert");
__exportStar(require("./test"), exports);
var switchboard_api_2 = require("@switchboard-xyz/switchboard-api");
Object.defineProperty(exports, "OracleJob", { enumerable: true, get: function () { return switchboard_api_2.OracleJob; } });
/**
 * Switchboard Devnet Program ID
 * 2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG
 */
exports.SBV2_DEVNET_PID = new web3_js_1.PublicKey("2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG");
/**
 * Switchboard Mainnet Program ID
 * SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f
 */
exports.SBV2_MAINNET_PID = new web3_js_1.PublicKey("SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f");
exports.GOVERNANCE_PID = new web3_js_1.PublicKey(
//"GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
"2iNnEMZuLk2TysefLvXtS6kyvCFC7CDUTLLeatVgRend");
/**
 * Load the Switchboard Program ID for a given cluster
 * @param cluster solana cluster to fetch program ID for
 * @return Switchboard Program ID Public Key
 */
function getSwitchboardPid(cluster) {
    switch (cluster) {
        case "devnet":
            return exports.SBV2_DEVNET_PID;
        case "mainnet-beta":
            return exports.SBV2_MAINNET_PID;
        default:
            throw new Error(`no Switchboard PID associated with cluster ${cluster}`);
    }
}
exports.getSwitchboardPid = getSwitchboardPid;
/**
 * Load the Switchboard Program for a given cluster
 * @param cluster solana cluster to interact with
 * @param connection optional Connection object to use for rpc request
 * @param payerKeypair optional Keypair to use for onchain txns. If ommited, a dummy keypair will be used and onchain txns will fail
 * @param confirmOptions optional confirmation options for rpc request
 * @return Switchboard Program
 */
async function loadSwitchboardProgram(cluster, connection = new web3_js_1.Connection(web3_js_1.clusterApiUrl(cluster)), payerKeypair, confirmOptions = {
    commitment: "confirmed",
}) {
    const DEFAULT_KEYPAIR = web3_js_1.Keypair.fromSeed(new Uint8Array(32).fill(1));
    const programId = getSwitchboardPid(cluster);
    const wallet = payerKeypair
        ? new nodewallet_1.default(payerKeypair)
        : new nodewallet_1.default(DEFAULT_KEYPAIR);
    const provider = new anchor.AnchorProvider(connection, wallet, confirmOptions);
    const anchorIdl = await anchor.Program.fetchIdl(programId, provider);
    if (!anchorIdl) {
        throw new Error(`failed to read idl for ${cluster} ${programId}`);
    }
    return new anchor.Program(anchorIdl, programId, provider);
}
exports.loadSwitchboardProgram = loadSwitchboardProgram;
/**
 * Switchboard precisioned representation of numbers.
 */
class SwitchboardDecimal {
    constructor(mantissa, scale) {
        this.mantissa = mantissa;
        this.scale = scale;
    }
    /**
     * Convert untyped object to a Switchboard decimal, if possible.
     * @param obj raw object to convert from
     * @return SwitchboardDecimal
     */
    static from(obj) {
        return new SwitchboardDecimal(new anchor.BN(obj.mantissa), obj.scale);
    }
    /**
     * Convert a Big.js decimal to a Switchboard decimal.
     * @param big a Big.js decimal
     * @return a SwitchboardDecimal
     */
    static fromBig(big) {
        // Round to fit in Switchboard Decimal
        // TODO: smarter logic.
        big = big.round(20);
        let mantissa = new anchor.BN(big.c.join(""), 10);
        // Set the scale. Big.exponenet sets scale from the opposite side
        // SwitchboardDecimal does.
        let scale = big.c.slice(1).length - big.e;
        if (scale < 0) {
            mantissa = mantissa.mul(new anchor.BN(10, 10).pow(new anchor.BN(Math.abs(scale), 10)));
            scale = 0;
        }
        if (scale < 0) {
            throw new Error(`SwitchboardDecimal: Unexpected negative scale.`);
        }
        if (scale >= 28) {
            throw new Error("SwitchboardDecimalExcessiveScaleError");
        }
        // Set sign for the coefficient (mantissa)
        mantissa = mantissa.mul(new anchor.BN(big.s, 10));
        const result = new SwitchboardDecimal(mantissa, scale);
        if (big.sub(result.toBig()).abs().gt(new big_js_1.default(0.00005))) {
            throw new Error(`SwitchboardDecimal: Converted decimal does not match original:\n` +
                `out: ${result.toBig().toNumber()} vs in: ${big.toNumber()}\n` +
                `-- result mantissa and scale: ${result.mantissa.toString()} ${result.scale.toString()}\n` +
                `${result} ${result.toBig()}`);
        }
        return result;
    }
    /**
     * SwitchboardDecimal equality comparator.
     * @param other object to compare to.
     * @return true iff equal
     */
    eq(other) {
        return this.mantissa.eq(other.mantissa) && this.scale === other.scale;
    }
    /**
     * Convert SwitchboardDecimal to big.js Big type.
     * @return Big representation
     */
    toBig() {
        let mantissa = new anchor.BN(this.mantissa, 10);
        let s = 1;
        let c = [];
        const ZERO = new anchor.BN(0, 10);
        const TEN = new anchor.BN(10, 10);
        if (mantissa.lt(ZERO)) {
            s = -1;
            mantissa = mantissa.abs();
        }
        while (mantissa.gt(ZERO)) {
            c.unshift(mantissa.mod(TEN).toNumber());
            mantissa = mantissa.div(TEN);
        }
        const e = c.length - this.scale - 1;
        const result = new big_js_1.default(0);
        if (c.length === 0) {
            return result;
        }
        result.s = s;
        result.c = c;
        result.e = e;
        return result;
    }
}
exports.SwitchboardDecimal = SwitchboardDecimal;
/**
 * Account type representing Switchboard global program state.
 */
class ProgramStateAccount {
    /**
     * ProgramStateAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Constructs ProgramStateAccount from the static seed from which it was generated.
     * @return ProgramStateAccount and PDA bump tuple.
     */
    static fromSeed(program) {
        const [statePubkey, stateBump] = anchor.utils.publicKey.findProgramAddressSync([Buffer.from("STATE")], program.programId);
        return [
            new ProgramStateAccount({ program, publicKey: statePubkey }),
            stateBump,
        ];
    }
    /**
     * Load and parse ProgramStateAccount state based on the program IDL.
     * @return ProgramStateAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const state = await this.program.account.sbState.fetch(this.publicKey);
        state.ebuf = undefined;
        return state;
    }
    /**
     * Fetch the Switchboard token mint specified in the program state account.
     * @return Switchboard token mint.
     */
    async getTokenMint() {
        const payerKeypair = programWallet(this.program);
        const state = await this.loadData();
        const switchTokenMint = new spl.Token(this.program.provider.connection, state.tokenMint, spl.TOKEN_PROGRAM_ID, payerKeypair);
        return switchTokenMint;
    }
    /**
     * @return account size of the global ProgramStateAccount.
     */
    size() {
        return this.program.account.sbState.size;
    }
    static async getOrCreate(program, params) {
        const [account, seed] = ProgramStateAccount.fromSeed(program);
        try {
            await account.loadData();
        }
        catch (e) {
            try {
                await ProgramStateAccount.create(program, params);
            }
            catch { }
        }
        return [account, seed];
    }
    /**
     * Create and initialize the ProgramStateAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated ProgramStateAccount.
     */
    static async create(program, params) {
        var _a;
        const payerKeypair = programWallet(program);
        const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const psa = new ProgramStateAccount({
            program,
            publicKey: stateAccount.publicKey,
        });
        // Short circuit if already created.
        try {
            await psa.loadData();
            return psa;
        }
        catch (e) { }
        let mint = null;
        let vault = null;
        if (params.mint === undefined) {
            const decimals = 9;
            const token = await spl.Token.createMint(program.provider.connection, payerKeypair, payerKeypair.publicKey, null, decimals, spl.TOKEN_PROGRAM_ID);
            const tokenVault = await token.createAccount(payerKeypair.publicKey);
            mint = token.publicKey;
            await token.mintTo(tokenVault, payerKeypair.publicKey, [payerKeypair], 100000000);
            vault = tokenVault;
        }
        else {
            mint = params.mint;
            const token = new spl.Token(program.provider.connection, mint, spl.TOKEN_PROGRAM_ID, payerKeypair);
            vault = await token.createAccount(payerKeypair.publicKey);
        }
        await program.methods
            .programInit({
            stateBump,
        })
            .accounts({
            state: stateAccount.publicKey,
            authority: payerKeypair.publicKey,
            tokenMint: mint,
            vault,
            payer: payerKeypair.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            daoMint: (_a = params.daoMint) !== null && _a !== void 0 ? _a : mint,
        })
            .rpc();
        return psa;
    }
    /**
     * Transfer N tokens from the program vault to a specified account.
     * @param to The recipient of the vault tokens.
     * @param authority The vault authority required to sign the transfer tx.
     * @param params specifies the amount to transfer.
     * @return TransactionSignature
     */
    async vaultTransfer(to, authority, params) {
        const [statePubkey, stateBump] = anchor.utils.publicKey.findProgramAddressSync([Buffer.from("STATE")], this.program.programId);
        const vault = (await this.loadData()).tokenVault;
        return await this.program.methods
            .vaultTransfer({
            stateBump,
            amount: params.amount,
        })
            .accounts({
            state: statePubkey,
            to,
            vault,
            authority: authority.publicKey,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
        })
            .signers([authority])
            .rpc();
    }
}
exports.ProgramStateAccount = ProgramStateAccount;
/**
 * Switchboard wrapper for anchor program errors.
 */
class SwitchboardError {
    /**
     * Converts a numerical error code to a SwitchboardError based on the program
     * IDL.
     * @param program the Switchboard program object containing the program IDL.
     * @param code Error code to convert to a SwitchboardError object.
     * @return SwitchboardError
     */
    static fromCode(program, code) {
        var _a;
        for (const e of (_a = program.idl.errors) !== null && _a !== void 0 ? _a : []) {
            if (code === e.code) {
                let r = new SwitchboardError();
                r.program = program;
                r.name = e.name;
                r.code = e.code;
                r.msg = e.msg;
                return r;
            }
        }
        throw new Error(`Could not find SwitchboardError for error code ${code}`);
    }
}
exports.SwitchboardError = SwitchboardError;
/**
 * Row structure of elements in the aggregator history buffer.
 */
class AggregatorHistoryRow {
    static from(buf) {
        const timestamp = new anchor.BN(buf.slice(0, 8), "le");
        // TODO(mgild): does this work for negative???
        const mantissa = new anchor.BN(buf.slice(8, 24), "le");
        const scale = buf.readUInt32LE(24);
        const decimal = new SwitchboardDecimal(mantissa, scale);
        const res = new AggregatorHistoryRow();
        res.timestamp = timestamp;
        res.value = decimal.toBig();
        return res;
    }
}
exports.AggregatorHistoryRow = AggregatorHistoryRow;
/**
 * Account type representing an aggregator (data feed).
 */
class AggregatorAccount {
    /**
     * AggregatorAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    static decode(program, accountInfo) {
        const coder = new anchor.BorshAccountsCoder(program.idl);
        const key = "AggregatorAccountData";
        const aggregator = coder.decode(key, accountInfo === null || accountInfo === void 0 ? void 0 : accountInfo.data);
        return aggregator;
    }
    /**
     * Returns the aggregator's ID buffer in a stringified format.
     * @param aggregator A preloaded aggregator object.
     * @return The name of the aggregator.
     */
    static getName(aggregator) {
        // eslint-disable-next-line no-control-regex
        return String.fromCharCode(...aggregator.name).replace(/\u0000/g, "");
    }
    /**
     * Load and parse AggregatorAccount state based on the program IDL.
     * @return AggregatorAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const aggregator = await this.program.account.aggregatorAccountData.fetch(this.publicKey);
        aggregator.ebuf = undefined;
        return aggregator;
    }
    async loadHistory(aggregator) {
        var _a, _b;
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        if (aggregator.historyBuffer == web3_js_1.PublicKey.default) {
            return [];
        }
        const ROW_SIZE = 28;
        let buffer = (_b = (_a = (await this.program.provider.connection.getAccountInfo(aggregator.historyBuffer))) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : Buffer.from("");
        if (buffer.length < 12) {
            return [];
        }
        const insertIdx = buffer.readUInt32LE(8) * ROW_SIZE;
        // console.log(insertIdx);
        buffer = buffer.slice(12);
        const front = [];
        const tail = [];
        for (let i = 0; i < buffer.length; i += ROW_SIZE) {
            if (i + ROW_SIZE > buffer.length) {
                break;
            }
            const row = AggregatorHistoryRow.from(buffer.slice(i, i + ROW_SIZE));
            if (row.timestamp.eq(new anchor.BN(0))) {
                break;
            }
            if (i <= insertIdx) {
                tail.push(row);
            }
            else {
                front.push(row);
            }
        }
        return front.concat(tail);
    }
    /**
     * Get the latest confirmed value stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed value
     */
    async getLatestValue(aggregator, decimals = 20) {
        var _a, _b;
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        if (((_b = (_a = aggregator.latestConfirmedRound) === null || _a === void 0 ? void 0 : _a.numSuccess) !== null && _b !== void 0 ? _b : 0) === 0) {
            return null;
        }
        const mantissa = new big_js_1.default(aggregator.latestConfirmedRound.result.mantissa.toString());
        const scale = aggregator.latestConfirmedRound.result.scale;
        const oldDp = big_js_1.default.DP;
        big_js_1.default.DP = decimals;
        const result = mantissa.div(new big_js_1.default(10).pow(scale));
        big_js_1.default.DP = oldDp;
        return result;
    }
    /**
     * Get the timestamp latest confirmed round stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed timestamp
     */
    async getLatestFeedTimestamp(aggregator) {
        var _a, _b;
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        if (((_b = (_a = aggregator.latestConfirmedRound) === null || _a === void 0 ? void 0 : _a.numSuccess) !== null && _b !== void 0 ? _b : 0) === 0) {
            throw new Error("Aggregator currently holds no value.");
        }
        return aggregator.latestConfirmedRound.roundOpenTimestamp;
    }
    /**
     * Speciifies if the aggregator settings recommend reporting a new value
     * @param value The value which we are evaluating
     * @param aggregator The loaded aggegator schema
     * @returns boolean
     */
    static async shouldReportValue(value, aggregator) {
        var _a, _b;
        if (((_b = (_a = aggregator.latestConfirmedRound) === null || _a === void 0 ? void 0 : _a.numSuccess) !== null && _b !== void 0 ? _b : 0) === 0) {
            return true;
        }
        const timestamp = new anchor.BN(Math.round(Date.now() / 1000));
        if (aggregator.startAfter.gt(timestamp)) {
            return false;
        }
        const varianceThreshold = SwitchboardDecimal.from(aggregator.varianceThreshold).toBig();
        const latestResult = SwitchboardDecimal.from(aggregator.latestConfirmedRound.result).toBig();
        const forceReportPeriod = aggregator.forceReportPeriod;
        const lastTimestamp = aggregator.latestConfirmedRound.roundOpenTimestamp;
        if (lastTimestamp.add(aggregator.forceReportPeriod).lt(timestamp)) {
            return true;
        }
        let diff = safeDiv(latestResult, value);
        if (diff.abs().gt(1)) {
            diff = safeDiv(value, latestResult);
        }
        // I dont want to think about variance percentage when values cross 0.
        // Changes the scale of what we consider a "percentage".
        if (diff.lt(0)) {
            return true;
        }
        const changePercent = new big_js_1.default(1).minus(diff).mul(100);
        return changePercent.gt(varianceThreshold);
    }
    /**
     * Get the individual oracle results of the latest confirmed round.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest results by oracle pubkey
     */
    async getConfirmedRoundResults(aggregator) {
        var _a, _b;
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        if (((_b = (_a = aggregator.latestConfirmedRound) === null || _a === void 0 ? void 0 : _a.numSuccess) !== null && _b !== void 0 ? _b : 0) === 0) {
            throw new Error("Aggregator currently holds no value.");
        }
        const results = [];
        for (let i = 0; i < aggregator.oracleRequestBatchSize; ++i) {
            if (aggregator.latestConfirmedRound.mediansFulfilled[i] === true) {
                results.push({
                    oracleAccount: new OracleAccount({
                        program: this.program,
                        publicKey: aggregator.latestConfirmedRound.oraclePubkeysData[i],
                    }),
                    value: SwitchboardDecimal.from(aggregator.latestConfirmedRound.mediansData[i]).toBig(),
                });
            }
        }
        return results;
    }
    /**
     * Produces a hash of all the jobs currently in the aggregator
     * @return hash of all the feed jobs.
     */
    produceJobsHash(jobs) {
        const hash = crypto.createHash("sha256");
        for (const job of jobs) {
            const jobHasher = crypto.createHash("sha256");
            jobHasher.update(switchboard_api_1.OracleJob.encodeDelimited(job).finish());
            hash.update(jobHasher.digest());
        }
        return hash;
    }
    async loadCurrentRoundOracles(aggregator) {
        var _a, _b;
        const coder = new anchor.BorshAccountsCoder(this.program.idl);
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        const oracleAccountDatas = await anchor.utils.rpc.getMultipleAccounts(this.program.provider.connection, (_b = (_a = aggregator.currentRound) === null || _a === void 0 ? void 0 : _a.oraclePubkeysData) === null || _b === void 0 ? void 0 : _b.slice(0, aggregator.oracleRequestBatchSize));
        if (oracleAccountDatas === null) {
            throw new Error("Failed to load aggregator oracles");
        }
        return oracleAccountDatas.map((item) => coder.decode("OracleAccountData", item.account.data));
    }
    async loadJobAccounts(aggregator) {
        const coder = new anchor.BorshAccountsCoder(this.program.idl);
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        const jobAccountDatas = await anchor.utils.rpc.getMultipleAccounts(this.program.provider.connection, aggregator.jobPubkeysData.slice(0, aggregator.jobPubkeysSize));
        if (jobAccountDatas === null) {
            throw new Error("Failed to load feed jobs.");
        }
        const jobs = jobAccountDatas.map((item) => {
            return coder.decode("JobAccountData", item.account.data);
        });
        return jobs;
    }
    /**
     * Load and deserialize all jobs stored in this aggregator
     * @return Array<OracleJob>
     */
    async loadJobs(aggregator) {
        const coder = new anchor.BorshAccountsCoder(this.program.idl);
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        const jobAccountDatas = await anchor.utils.rpc.getMultipleAccounts(this.program.provider.connection, aggregator.jobPubkeysData.slice(0, aggregator.jobPubkeysSize));
        if (jobAccountDatas === null) {
            throw new Error("Failed to load feed jobs.");
        }
        const jobs = jobAccountDatas.map((item) => {
            let decoded = coder.decode("JobAccountData", item.account.data);
            return switchboard_api_1.OracleJob.decodeDelimited(decoded.data);
        });
        return jobs;
    }
    async loadHashes(aggregator) {
        const coder = new anchor.BorshAccountsCoder(this.program.idl);
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        const jobAccountDatas = await anchor.utils.rpc.getMultipleAccounts(this.program.provider.connection, aggregator.jobPubkeysData.slice(0, aggregator.jobPubkeysSize));
        if (jobAccountDatas === null) {
            throw new Error("Failed to load feed jobs.");
        }
        const jobs = jobAccountDatas.map((item) => {
            let decoded = coder.decode("JobAccountData", item.account.data);
            return decoded.hash;
        });
        return jobs;
    }
    /**
     * Get the size of an AggregatorAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.aggregatorAccountData.size;
    }
    /**
     * Create and initialize the AggregatorAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated AggregatorAccount.
     */
    static async create(program, params) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const payerKeypair = programWallet(program);
        const aggregatorAccount = (_a = params.keypair) !== null && _a !== void 0 ? _a : anchor.web3.Keypair.generate();
        const authority = (_b = params.authority) !== null && _b !== void 0 ? _b : aggregatorAccount.publicKey;
        const size = program.account.aggregatorAccountData.size;
        const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const state = await stateAccount.loadData();
        await program.methods
            .aggregatorInit({
            name: ((_c = params.name) !== null && _c !== void 0 ? _c : Buffer.from("")).slice(0, 32),
            metadata: ((_d = params.metadata) !== null && _d !== void 0 ? _d : Buffer.from("")).slice(0, 128),
            batchSize: params.batchSize,
            minOracleResults: params.minRequiredOracleResults,
            minJobResults: params.minRequiredJobResults,
            minUpdateDelaySeconds: params.minUpdateDelaySeconds,
            varianceThreshold: SwitchboardDecimal.fromBig(new big_js_1.default((_e = params.varianceThreshold) !== null && _e !== void 0 ? _e : 0)),
            forceReportPeriod: (_f = params.forceReportPeriod) !== null && _f !== void 0 ? _f : new anchor.BN(0),
            expiration: (_g = params.expiration) !== null && _g !== void 0 ? _g : new anchor.BN(0),
            stateBump,
        })
            .accounts({
            aggregator: aggregatorAccount.publicKey,
            authority,
            queue: params.queueAccount.publicKey,
            authorWallet: (_h = params.authorWallet) !== null && _h !== void 0 ? _h : state.tokenVault,
            programState: stateAccount.publicKey,
        })
            .signers([aggregatorAccount])
            .preInstructions([
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: programWallet(program).publicKey,
                newAccountPubkey: aggregatorAccount.publicKey,
                space: size,
                lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                programId: program.programId,
            }),
        ])
            .rpc();
        return new AggregatorAccount({ program, keypair: aggregatorAccount });
    }
    async setBatchSize(params) {
        var _a, _b;
        const program = this.program;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await program.methods
            .aggregatorSetBatchSize({
            batchSize: params.batchSize,
        })
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    async setVarianceThreshold(params) {
        var _a, _b;
        const program = this.program;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await program.rpc.aggregatorSetVarianceThreshold({
            varianceThreshold: SwitchboardDecimal.fromBig(params.threshold),
        }, {
            accounts: {
                aggregator: this.publicKey,
                authority: authority.publicKey,
            },
            signers: [authority],
        });
    }
    async setMinJobs(params) {
        var _a, _b;
        const program = this.program;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await program.methods
            .aggregatorSetMinJobs({
            minJobResults: params.minJobResults,
        })
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    async setMinOracles(params) {
        var _a, _b;
        const program = this.program;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await program.methods
            .aggregatorSetMinOracles({
            minOracleResults: params.minOracleResults,
        })
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    async setHistoryBuffer(params) {
        var _a, _b;
        const buffer = web3_js_1.Keypair.generate();
        const program = this.program;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        const HISTORY_ROW_SIZE = 28;
        const INSERT_IDX_SIZE = 4;
        const DISCRIMINATOR_SIZE = 8;
        const size = params.size * HISTORY_ROW_SIZE + INSERT_IDX_SIZE + DISCRIMINATOR_SIZE;
        return await program.methods
            .aggregatorSetHistoryBuffer({})
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
            buffer: buffer.publicKey,
        })
            .signers([authority, buffer])
            .preInstructions([
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: programWallet(program).publicKey,
                newAccountPubkey: buffer.publicKey,
                space: size,
                lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                programId: program.programId,
            }),
        ])
            .rpc();
    }
    async setUpdateInterval(params) {
        var _a, _b;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await this.program.methods
            .aggregatorSetUpdateInterval({
            newInterval: params.newInterval,
        })
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    async setQueue(params) {
        var _a, _b;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await this.program.methods
            .aggregatorSetQueue({})
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
            queue: params.queueAccount.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    /**
     * RPC to add a new job to an aggregtor to be performed on feed updates.
     * @param job JobAccount specifying another job for this aggregator to fulfill on update
     * @return TransactionSignature
     */
    async addJob(job, authority, weight = 1) {
        var _a;
        authority = (_a = authority !== null && authority !== void 0 ? authority : this.keypair) !== null && _a !== void 0 ? _a : programWallet(this.program);
        return await this.program.methods
            .aggregatorAddJob({
            weight,
        })
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
            job: job.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    /**
     * Prevent new jobs from being added to the feed.
     * @param authority The current authroity keypair
     * @return TransactionSignature
     */
    async lock(authority) {
        var _a;
        authority = (_a = authority !== null && authority !== void 0 ? authority : this.keypair) !== null && _a !== void 0 ? _a : programWallet(this.program);
        return await this.program.methods
            .aggregatorLock({})
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    /**
     * Change the aggregator authority.
     * @param currentAuthority The current authroity keypair
     * @param newAuthority The new authority to set.
     * @return TransactionSignature
     */
    async setAuthority(newAuthority, currentAuthority) {
        var _a;
        currentAuthority =
            (_a = currentAuthority !== null && currentAuthority !== void 0 ? currentAuthority : this.keypair) !== null && _a !== void 0 ? _a : programWallet(this.program);
        return await this.program.methods
            .aggregatorSetAuthority({})
            .accounts({
            aggregator: this.publicKey,
            newAuthority,
            authority: currentAuthority.publicKey,
        })
            .signers([currentAuthority])
            .rpc();
    }
    /**
     * RPC to remove a job from an aggregtor.
     * @param job JobAccount to be removed from the aggregator
     * @return TransactionSignature
     */
    async removeJob(job, authority) {
        var _a;
        authority = (_a = authority !== null && authority !== void 0 ? authority : this.keypair) !== null && _a !== void 0 ? _a : programWallet(this.program);
        return await this.program.methods
            .aggregatorRemoveJob({})
            .accounts({
            aggregator: this.publicKey,
            authority: authority.publicKey,
            job: job.publicKey,
        })
            .signers([authority])
            .rpc();
    }
    /**
     * Opens a new round for the aggregator and will provide an incentivize reward
     * to the caller
     * @param params
     * @return TransactionSignature
     */
    async openRound(params) {
        const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(this.program, params.oracleQueueAccount, this);
        try {
            await leaseAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested lease pda account has not been initialized.");
        }
        const escrowPubkey = (await leaseAccount.loadData()).escrow;
        const queue = await params.oracleQueueAccount.loadData();
        const queueAuthority = queue.authority;
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queueAuthority, params.oracleQueueAccount.publicKey, this.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested permission pda account has not been initialized.");
        }
        return await this.program.methods
            .aggregatorOpenRound({
            stateBump,
            leaseBump,
            permissionBump,
        })
            .accounts({
            aggregator: this.publicKey,
            lease: leaseAccount.publicKey,
            oracleQueue: params.oracleQueueAccount.publicKey,
            queueAuthority,
            permission: permissionAccount.publicKey,
            escrow: escrowPubkey,
            programState: stateAccount.publicKey,
            payoutWallet: params.payoutWallet,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            dataBuffer: queue.dataBuffer,
            mint: (await params.oracleQueueAccount.loadMint()).publicKey,
        })
            .rpc();
    }
    async getOracleIndex(oraclePubkey) {
        const aggregator = await this.loadData();
        for (let i = 0; i < aggregator.oracleRequestBatchSize; i++) {
            if (aggregator.currentRound.oraclePubkeysData[i].equals(oraclePubkey)) {
                return i;
            }
        }
        return -1;
    }
    async saveResult(aggregator, oracleAccount, params) {
        return (await this.program.provider.sendAll([
            {
                tx: await this.saveResultTxn(aggregator, oracleAccount, params),
                signers: [programWallet(this.program)],
            },
        ]))[0];
    }
    /**
     * RPC for an oracle to save a result to an aggregator round.
     * @param oracleAccount The oracle account submitting a result.
     * @param params
     * @return TransactionSignature
     */
    async saveResultTxn(aggregator, oracleAccount, // TODO: move to params.
    params) {
        var _a;
        let oracles = (_a = params.oracles) !== null && _a !== void 0 ? _a : [];
        if (oracles.length === 0) {
            oracles = await this.loadCurrentRoundOracles(aggregator);
        }
        const payerKeypair = programWallet(this.program);
        const remainingAccounts = [];
        for (let i = 0; i < aggregator.oracleRequestBatchSize; ++i) {
            remainingAccounts.push(aggregator.currentRound.oraclePubkeysData[i]);
        }
        for (const oracle of oracles) {
            remainingAccounts.push(oracle.tokenAccount);
        }
        const queuePubkey = aggregator.queuePubkey;
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: queuePubkey,
        });
        const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(this.program, queueAccount, this);
        // const escrow = await spl.Token.getAssociatedTokenAddress(
        // spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        // params.tokenMint,
        // this.program.programId,
        // leaseAccount.publicKey
        // );
        const escrow = await spl.Token.getAssociatedTokenAddress(spl.ASSOCIATED_TOKEN_PROGRAM_ID, spl.TOKEN_PROGRAM_ID, params.tokenMint, leaseAccount.publicKey, true);
        const [feedPermissionAccount, feedPermissionBump] = PermissionAccount.fromSeed(this.program, params.queueAuthority, queueAccount.publicKey, this.publicKey);
        const [oraclePermissionAccount, oraclePermissionBump] = PermissionAccount.fromSeed(this.program, params.queueAuthority, queueAccount.publicKey, oracleAccount.publicKey);
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const digest = this.produceJobsHash(params.jobs).digest();
        let historyBuffer = aggregator.historyBuffer;
        if (historyBuffer.equals(web3_js_1.PublicKey.default)) {
            historyBuffer = this.publicKey;
        }
        return await this.program.methods
            .aggregatorSaveResult({
            oracleIdx: params.oracleIdx,
            error: params.error,
            value: SwitchboardDecimal.fromBig(params.value),
            jobsChecksum: digest,
            minResponse: SwitchboardDecimal.fromBig(params.minResponse),
            maxResponse: SwitchboardDecimal.fromBig(params.maxResponse),
            feedPermissionBump,
            oraclePermissionBump,
            leaseBump,
            stateBump,
        })
            .accounts({
            aggregator: this.publicKey,
            oracle: oracleAccount.publicKey,
            oracleAuthority: payerKeypair.publicKey,
            oracleQueue: queueAccount.publicKey,
            queueAuthority: params.queueAuthority,
            feedPermission: feedPermissionAccount.publicKey,
            oraclePermission: oraclePermissionAccount.publicKey,
            lease: leaseAccount.publicKey,
            escrow,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            programState: programStateAccount.publicKey,
            historyBuffer,
            mint: params.tokenMint,
        })
            .remainingAccounts(remainingAccounts.map((pubkey) => {
            return { isSigner: false, isWritable: true, pubkey };
        }))
            .transaction();
    }
}
exports.AggregatorAccount = AggregatorAccount;
/**
 * A Switchboard account representing a job for an oracle to perform, stored as
 * a protocol buffer.
 */
class JobAccount {
    /**
     * JobAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Load and parse JobAccount data based on the program IDL.
     * @return JobAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const job = await this.program.account.jobAccountData.fetch(this.publicKey);
        return job;
    }
    /**
     * Load and parse the protobuf from the raw buffer stored in the JobAccount.
     * @return OracleJob
     */
    async loadJob() {
        let job = await this.loadData();
        return switchboard_api_1.OracleJob.decodeDelimited(job.data);
    }
    /**
     * Create and initialize the JobAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated JobAccount.
     */
    static async create(program, params) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const payerKeypair = programWallet(program);
        const jobAccount = (_a = params.keypair) !== null && _a !== void 0 ? _a : anchor.web3.Keypair.generate();
        const size = 280 + params.data.length + ((_d = (_c = (_b = params.variables) === null || _b === void 0 ? void 0 : _b.join("")) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0);
        const [stateAccount, stateBump] = await ProgramStateAccount.getOrCreate(program, {});
        const state = await stateAccount.loadData();
        await program.methods
            .jobInit({
            name: (_e = params.name) !== null && _e !== void 0 ? _e : Buffer.from(""),
            expiration: (_f = params.expiration) !== null && _f !== void 0 ? _f : new anchor.BN(0),
            data: params.data,
            variables: (_h = (_g = params.variables) === null || _g === void 0 ? void 0 : _g.map((item) => Buffer.from(""))) !== null && _h !== void 0 ? _h : new Array(),
            stateBump,
        })
            .accounts({
            job: jobAccount.publicKey,
            authorWallet: params.authority,
            authority: params.authority,
            programState: stateAccount.publicKey,
        })
            .signers([jobAccount])
            .preInstructions([
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: programWallet(program).publicKey,
                newAccountPubkey: jobAccount.publicKey,
                space: size,
                lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                programId: program.programId,
            }),
        ])
            .rpc();
        return new JobAccount({ program, keypair: jobAccount });
    }
    static decode(program, accountInfo) {
        const coder = new anchor.BorshAccountsCoder(program.idl);
        const key = "JobAccountData";
        const data = coder.decode(key, accountInfo === null || accountInfo === void 0 ? void 0 : accountInfo.data);
        return data;
    }
    static decodeJob(program, accountInfo) {
        return switchboard_api_1.OracleJob.decodeDelimited(JobAccount.decode(program, accountInfo).data);
    }
}
exports.JobAccount = JobAccount;
/**
 * An enum representing all known permission types for Switchboard.
 */
var SwitchboardPermission;
(function (SwitchboardPermission) {
    SwitchboardPermission["PERMIT_ORACLE_HEARTBEAT"] = "permitOracleHeartbeat";
    SwitchboardPermission["PERMIT_ORACLE_QUEUE_USAGE"] = "permitOracleQueueUsage";
    SwitchboardPermission["PERMIT_VRF_REQUESTS"] = "permitVrfRequests";
})(SwitchboardPermission = exports.SwitchboardPermission || (exports.SwitchboardPermission = {}));
var SwitchboardPermissionValue;
(function (SwitchboardPermissionValue) {
    SwitchboardPermissionValue[SwitchboardPermissionValue["PERMIT_ORACLE_HEARTBEAT"] = 1] = "PERMIT_ORACLE_HEARTBEAT";
    SwitchboardPermissionValue[SwitchboardPermissionValue["PERMIT_ORACLE_QUEUE_USAGE"] = 2] = "PERMIT_ORACLE_QUEUE_USAGE";
    SwitchboardPermissionValue[SwitchboardPermissionValue["PERMIT_VRF_REQUESTS"] = 4] = "PERMIT_VRF_REQUESTS";
})(SwitchboardPermissionValue = exports.SwitchboardPermissionValue || (exports.SwitchboardPermissionValue = {}));
/**
 * A Switchboard account representing a permission or privilege granted by one
 * account signer to another account.
 */
class PermissionAccount {
    /**
     * PermissionAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Check if a specific permission is enabled on this permission account
     */
    async isPermissionEnabled(permission) {
        const permissions = (await this.loadData()).permissions;
        return (permissions & permission) != 0;
    }
    /**
     * Load and parse PermissionAccount data based on the program IDL.
     * @return PermissionAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const permission = await this.program.account.permissionAccountData.fetch(this.publicKey);
        permission.ebuf = undefined;
        return permission;
    }
    /**
     * Get the size of a PermissionAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.permissionAccountData.size;
    }
    /**
     * Create and initialize the PermissionAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated PermissionAccount.
     */
    static async create(program, params) {
        const authorityInfo = await program.provider.connection.getAccountInfo(params.authority);
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(program, params.authority, params.granter, params.grantee);
        const payerKeypair = programWallet(program);
        await program.methods
            .permissionInit({})
            .accounts({
            permission: permissionAccount.publicKey,
            authority: params.authority,
            granter: params.granter,
            grantee: params.grantee,
            payer: programWallet(program).publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .signers([payerKeypair])
            .rpc();
        return new PermissionAccount({
            program,
            publicKey: permissionAccount.publicKey,
        });
    }
    /**
     * Loads a PermissionAccount from the expected PDA seed format.
     * @param authority The authority pubkey to be incorporated into the account seed.
     * @param granter The granter pubkey to be incorporated into the account seed.
     * @param grantee The grantee pubkey to be incorporated into the account seed.
     * @return PermissionAccount and PDA bump.
     */
    static fromSeed(program, authority, granter, grantee) {
        const [pubkey, bump] = anchor.utils.publicKey.findProgramAddressSync([
            Buffer.from("PermissionAccountData"),
            authority.toBytes(),
            granter.toBytes(),
            grantee.toBytes(),
        ], program.programId);
        return [new PermissionAccount({ program, publicKey: pubkey }), bump];
    }
    /**
     * Sets the permission in the PermissionAccount
     * @param params.
     * @return TransactionSignature.
     */
    async set(params) {
        if (!("publicKey" in params.authority)) {
            throw new Error("Authority cannot be a PublicKey for the set RPC method.");
        }
        const permissionData = await this.loadData();
        const authorityInfo = await this.program.provider.connection.getAccountInfo(permissionData.authority);
        const permission = new Map();
        permission.set(params.permission.toString(), null);
        return await this.program.methods
            .permissionSet({
            permission: Object.fromEntries(permission),
            enable: params.enable,
        })
            .accounts({
            permission: this.publicKey,
            authority: params.authority.publicKey,
        })
            .signers([params.authority])
            .rpc();
    }
    /**
     * Sets the permission in the PermissionAccount
     * @param params.
     * @return TransactionSignature.
     */
    async setTx(params) {
        const permissionData = await this.loadData();
        let authPk;
        const signers = [];
        if ("publicKey" in params.authority) {
            authPk = params.authority.publicKey;
            signers.push(params.authority);
        }
        else {
            authPk = params.authority;
        }
        const authorityInfo = await this.program.provider.connection.getAccountInfo(permissionData.authority);
        const permission = new Map();
        permission.set(params.permission.toString(), null);
        console.log("authority:");
        console.log(authPk);
        return await this.program.methods
            .permissionSet({
            permission: Object.fromEntries(permission),
            enable: params.enable,
        })
            .accounts({
            permission: this.publicKey,
            authority: authPk,
        })
            .signers(signers)
            .transaction();
    }
    /*async setVoterWeight(
      params: PermissionSetVoterWeightParams
    ): Promise<TransactionSignature> {
      const payerKeypair = programWallet(this.program);
      const tx = await this.setVoterWeightTx(params);
      return await sendAndConfirmTransaction(
        this.program.provider.connection,
        tx,
        [payerKeypair]
      );
    }*/
    async setVoterWeightTx(params, addinProgram, someGovernance) {
        const permissionData = await this.loadData();
        const oracleData = await this.program.account.oracleAccountData.fetch(permissionData.grantee);
        let payerKeypair;
        if (params.pubkeySigner == undefined) {
            payerKeypair = programWallet(this.program);
        }
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        let psData = await programStateAccount.loadData();
        let [addinState, _] = await web3_js_1.PublicKey.findProgramAddress([
            Buffer.from('state'),
        ], addinProgram.programId);
        const governance = (await spl_governance_1.getGovernance(this.program.provider.connection, someGovernance)).account;
        const [realmSpawnRecord] = anchor.utils.publicKey.findProgramAddressSync([Buffer.from("RealmSpawnRecord"), governance.realm.toBytes()], addinProgram.programId);
        const [voterWeightRecord] = anchor.utils.publicKey.findProgramAddressSync([Buffer.from("VoterWeightRecord"), permissionData.grantee.toBytes()], addinProgram.programId);
        const [tokenOwnerRecord] = anchor.utils.publicKey.findProgramAddressSync([
            Buffer.from("governance"),
            governance.realm.toBytes(),
            psData.daoMint.toBytes(),
            oracleData.oracleAuthority.toBytes(),
        ], params.govProgram);
        if (params.pubkeySigner != undefined) {
            return await addinProgram.methods
                .permissionSetVoterWeight()
                .accounts({
                permission: this.publicKey,
                permissionAuthority: permissionData.authority,
                oracle: permissionData.grantee,
                oracleAuthority: oracleData.oracleAuthority,
                payer: params.pubkeySigner,
                systemProgram: web3_js_1.SystemProgram.programId,
                sbState: programStateAccount.publicKey,
                programState: addinState,
                govProgram: exports.GOVERNANCE_PID,
                daoMint: psData.daoMint,
                spawnRecord: realmSpawnRecord,
                voterWeight: voterWeightRecord,
                tokenOwnerRecord: tokenOwnerRecord,
                realm: governance.realm,
            })
                .transaction();
        }
        else {
            return await addinProgram.methods
                .permissionSetVoterWeight()
                .accounts({
                permission: this.publicKey,
                permissionAuthority: permissionData.authority,
                oracle: permissionData.grantee,
                oracleAuthority: oracleData.oracleAuthority,
                payer: payerKeypair.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
                sbState: programStateAccount.publicKey,
                programState: addinState,
                govProgram: exports.GOVERNANCE_PID,
                daoMint: psData.daoMint,
                spawnRecord: realmSpawnRecord,
                voterWeight: voterWeightRecord,
                tokenOwnerRecord: tokenOwnerRecord,
                realm: governance.realm,
            })
                .signers([payerKeypair])
                .transaction();
        }
    }
}
exports.PermissionAccount = PermissionAccount;
/**
 * A Switchboard account representing a queue for distributing oracles to
 * permitted data feeds.
 */
class OracleQueueAccount {
    /**
     * OracleQueueAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    async loadMint() {
        var _a;
        const payerKeypair = programWallet(this.program);
        const queue = await this.loadData();
        let mintKey = (_a = queue.mint) !== null && _a !== void 0 ? _a : web3_js_1.PublicKey.default;
        if (mintKey.equals(web3_js_1.PublicKey.default)) {
            mintKey = spl.NATIVE_MINT;
        }
        return new spl.Token(this.program.provider.connection, mintKey, spl.TOKEN_PROGRAM_ID, payerKeypair);
    }
    /**
     * Load and parse OracleQueueAccount data based on the program IDL.
     * @return OracleQueueAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        var _a, _b;
        const queue = await this.program.account.oracleQueueAccountData.fetch(this.publicKey);
        const queueData = [];
        const buffer = (_b = (_a = (await this.program.provider.connection.getAccountInfo(queue.dataBuffer))) === null || _a === void 0 ? void 0 : _a.data.slice(8)) !== null && _b !== void 0 ? _b : Buffer.from("");
        const rowSize = 32;
        for (let i = 0; i < queue.size * rowSize; i += rowSize) {
            if (buffer.length - i < rowSize) {
                break;
            }
            const pubkeyBuf = buffer.slice(i, i + rowSize);
            const key = new web3_js_1.PublicKey(pubkeyBuf);
            if (key === web3_js_1.PublicKey.default) {
                break;
            }
            queueData.push(key);
        }
        queue.queue = queueData;
        queue.ebuf = undefined;
        return queue;
    }
    /**
     * Get the size of an OracleQueueAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.oracleQueueAccountData.size;
    }
    /**
     * Create and initialize the OracleQueueAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated OracleQueueAccount.
     */
    static async create(program, params) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const payerKeypair = programWallet(program);
        const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        /*const mint = (await stateAccount.getTokenMint()).publicKey;*/
        const mint = params.mint;
        const oracleQueueAccount = anchor.web3.Keypair.generate();
        const buffer = anchor.web3.Keypair.generate();
        const size = program.account.oracleQueueAccountData.size;
        params.queueSize = (_a = params.queueSize) !== null && _a !== void 0 ? _a : 500;
        const queueSize = params.queueSize * 32 + 8;
        await program.methods
            .oracleQueueInit({
            name: ((_b = params.name) !== null && _b !== void 0 ? _b : Buffer.from("")).slice(0, 32),
            metadata: ((_c = params.metadata) !== null && _c !== void 0 ? _c : Buffer.from("")).slice(0, 64),
            reward: (_d = params.reward) !== null && _d !== void 0 ? _d : new anchor.BN(0),
            minStake: (_e = params.minStake) !== null && _e !== void 0 ? _e : new anchor.BN(0),
            feedProbationPeriod: (_f = params.feedProbationPeriod) !== null && _f !== void 0 ? _f : 0,
            oracleTimeout: (_g = params.oracleTimeout) !== null && _g !== void 0 ? _g : 180,
            slashingEnabled: (_h = params.slashingEnabled) !== null && _h !== void 0 ? _h : false,
            varianceToleranceMultiplier: SwitchboardDecimal.fromBig(new big_js_1.default((_j = params.varianceToleranceMultiplier) !== null && _j !== void 0 ? _j : 2)),
            authority: params.authority,
            consecutiveFeedFailureLimit: (_k = params.consecutiveFeedFailureLimit) !== null && _k !== void 0 ? _k : new anchor.BN(1000),
            consecutiveOracleFailureLimit: (_l = params.consecutiveOracleFailureLimit) !== null && _l !== void 0 ? _l : new anchor.BN(1000),
            minimumDelaySeconds: (_m = params.minimumDelaySeconds) !== null && _m !== void 0 ? _m : 5,
            queueSize: params.queueSize,
            unpermissionedFeeds: (_o = params.unpermissionedFeeds) !== null && _o !== void 0 ? _o : false,
        })
            .accounts({
            oracleQueue: oracleQueueAccount.publicKey,
            authority: params.authority,
            buffer: buffer.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            payer: programWallet(program).publicKey,
            mint,
        })
            .signers([oracleQueueAccount, buffer])
            .preInstructions([
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: programWallet(program).publicKey,
                newAccountPubkey: buffer.publicKey,
                space: queueSize,
                lamports: await program.provider.connection.getMinimumBalanceForRentExemption(queueSize),
                programId: program.programId,
            }),
        ])
            .rpc();
        return new OracleQueueAccount({ program, keypair: oracleQueueAccount });
    }
    async setRewards(params) {
        var _a, _b;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await this.program.methods
            .oracleQueueSetRewards({
            rewards: params.rewards,
        })
            .accounts({ queue: this.publicKey, authority: authority.publicKey })
            .signers([authority])
            .rpc();
    }
    async setVrfSettings(params) {
        var _a, _b;
        const authority = (_b = (_a = params.authority) !== null && _a !== void 0 ? _a : this.keypair) !== null && _b !== void 0 ? _b : programWallet(this.program);
        return await this.program.methods
            .oracleQueueVrfConfig({
            unpermissionedVrfEnabled: params.unpermissionedVrf,
        })
            .accounts({
            queue: this.publicKey,
            authority: authority.publicKey,
        })
            .signers([authority])
            .rpc();
    }
}
exports.OracleQueueAccount = OracleQueueAccount;
/**
 * A Switchboard account representing a lease for managing funds for oracle payouts
 * for fulfilling feed updates.
 */
class LeaseAccount {
    /**
     * LeaseAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Loads a LeaseAccount from the expected PDA seed format.
     * @param leaser The leaser pubkey to be incorporated into the account seed.
     * @param target The target pubkey to be incorporated into the account seed.
     * @return LeaseAccount and PDA bump.
     */
    static fromSeed(program, queueAccount, aggregatorAccount) {
        const [pubkey, bump] = anchor.utils.publicKey.findProgramAddressSync([
            Buffer.from("LeaseAccountData"),
            queueAccount.publicKey.toBytes(),
            aggregatorAccount.publicKey.toBytes(),
        ], program.programId);
        return [new LeaseAccount({ program, publicKey: pubkey }), bump];
    }
    /**
     * Load and parse LeaseAccount data based on the program IDL.
     * @return LeaseAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const lease = await this.program.account.leaseAccountData.fetch(this.publicKey);
        lease.ebuf = undefined;
        return lease;
    }
    /**
     * Get the size of a LeaseAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.leaseAccountData.size;
    }
    /**
     * Create and initialize the LeaseAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated LeaseAccount.
     */
    static async create(program, params) {
        var _a, _b;
        const payerKeypair = programWallet(program);
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const switchTokenMint = await params.oracleQueueAccount.loadMint();
        const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(program, params.oracleQueueAccount, params.aggregatorAccount);
        const escrow = await spl.Token.getAssociatedTokenAddress(spl.ASSOCIATED_TOKEN_PROGRAM_ID, spl.TOKEN_PROGRAM_ID, switchTokenMint.publicKey, leaseAccount.publicKey, true);
        await switchTokenMint.createAssociatedTokenAccountInternal(leaseAccount.publicKey, escrow);
        const jobAccountDatas = await params.aggregatorAccount.loadJobAccounts();
        const aggregatorData = await params.aggregatorAccount.loadData();
        const jobPubkeys = aggregatorData.jobPubkeysData.slice(0, aggregatorData.jobPubkeysSize);
        const jobWallets = [];
        const walletBumps = [];
        for (let idx in jobAccountDatas) {
            const jobAccountData = jobAccountDatas[idx];
            const authority = (_a = jobAccountData.authority) !== null && _a !== void 0 ? _a : web3_js_1.PublicKey.default;
            const [jobWallet, bump] = await web3_js_1.PublicKey.findProgramAddress([
                authority.toBuffer(),
                spl.TOKEN_PROGRAM_ID.toBuffer(),
                switchTokenMint.publicKey.toBuffer(),
            ], spl.ASSOCIATED_TOKEN_PROGRAM_ID);
            jobWallets.push(jobWallet);
            walletBumps.push(bump);
        }
        await program.methods
            .leaseInit({
            loadAmount: params.loadAmount,
            stateBump,
            leaseBump,
            withdrawAuthority: (_b = params.withdrawAuthority) !== null && _b !== void 0 ? _b : web3_js_1.PublicKey.default,
            walletBumps: Buffer.from(walletBumps),
        })
            .accounts({
            programState: programStateAccount.publicKey,
            lease: leaseAccount.publicKey,
            queue: params.oracleQueueAccount.publicKey,
            aggregator: params.aggregatorAccount.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            funder: params.funder,
            payer: programWallet(program).publicKey,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            escrow,
            owner: params.funderAuthority.publicKey,
            mint: switchTokenMint.publicKey,
        })
            .signers([params.funderAuthority])
            .remainingAccounts(jobPubkeys.concat(jobWallets).map((pubkey) => {
            return { isSigner: false, isWritable: true, pubkey };
        }))
            .rpc();
        return new LeaseAccount({ program, publicKey: leaseAccount.publicKey });
    }
    async getBalance() {
        // const [programStateAccount] = ProgramStateAccount.fromSeed(this.program);
        // const switchTokenMint = await programStateAccount.getTokenMint();
        // const mintData = await this.program.provider.connection.getAccountInfo(
        // switchTokenMint.publicKey
        // );
        // const mintInfo = spl.TokenLayout.decode(mintData);
        // const decimals = spl.u8.fromBuffer(mintInfo.decimals).toNumber();
        const lease = await this.loadData();
        const escrowInfo = await this.program.provider.connection.getAccountInfo(lease.escrow);
        const data = Buffer.from(escrowInfo.data);
        const accountInfo = spl.AccountLayout.decode(data);
        const balance = spl.u64.fromBuffer(accountInfo.amount).toNumber();
        return balance; // / mintInfo.decimals;
    }
    /**
     * Estimate the time remaining on a given lease
     * @params void
     * @returns number milliseconds left in lease (estimate)
     */
    async estimatedLeaseTimeRemaining() {
        // get lease data for escrow + aggregator pubkeys
        const lease = await this.loadData();
        const aggregatorAccount = new AggregatorAccount({
            program: this.program,
            publicKey: lease.aggregator,
        });
        // get aggregator data for minUpdateDelaySeconds + batchSize + queue pubkey
        const aggregator = await aggregatorAccount.loadData();
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: aggregator.queuePubkey,
        });
        const queue = await queueAccount.loadData();
        const batchSize = aggregator.oracleRequestBatchSize + 1;
        const minUpdateDelaySeconds = aggregator.minUpdateDelaySeconds * 1.5; // account for jitters with * 1.5
        const updatesPerDay = (60 * 60 * 24) / minUpdateDelaySeconds;
        const costPerDay = batchSize * queue.reward * updatesPerDay;
        const oneDay = 24 * 60 * 60 * 1000; // ms in a day
        const escrowInfo = await this.program.provider.connection.getAccountInfo(lease.escrow);
        const data = Buffer.from(escrowInfo.data);
        const accountInfo = spl.AccountLayout.decode(data);
        const balance = spl.u64.fromBuffer(accountInfo.amount).toNumber();
        const endDate = new Date();
        endDate.setTime(endDate.getTime() + (balance * oneDay) / costPerDay);
        const timeLeft = endDate.getTime() - new Date().getTime();
        return timeLeft;
    }
    /**
     * Adds fund to a LeaseAccount. Note that funds can always be withdrawn by
     * the withdraw authority if one was set on lease initialization.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     */
    async extend(params) {
        var _a;
        const program = this.program;
        const lease = await this.loadData();
        const escrow = lease.escrow;
        const queue = lease.queue;
        const queueAccount = new OracleQueueAccount({ program, publicKey: queue });
        const aggregator = lease.aggregator;
        const aggregatorAccount = new AggregatorAccount({
            program,
            publicKey: aggregator,
        });
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const switchTokenMint = await queueAccount.loadMint();
        const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(program, queueAccount, aggregatorAccount);
        const aggregatorData = await aggregatorAccount.loadData();
        const jobPubkeys = aggregatorData.jobPubkeysData.slice(0, aggregatorData.jobPubkeysSize);
        const jobAccountDatas = await aggregatorAccount.loadJobAccounts();
        const jobWallets = [];
        const walletBumps = [];
        for (let idx in jobAccountDatas) {
            const jobAccountData = jobAccountDatas[idx];
            const authority = (_a = jobAccountData.authority) !== null && _a !== void 0 ? _a : web3_js_1.PublicKey.default;
            const [jobWallet, bump] = await web3_js_1.PublicKey.findProgramAddress([
                authority.toBuffer(),
                spl.TOKEN_PROGRAM_ID.toBuffer(),
                switchTokenMint.publicKey.toBuffer(),
            ], spl.ASSOCIATED_TOKEN_PROGRAM_ID);
            jobWallets.push(jobWallet);
            walletBumps.push(bump);
        }
        return await program.methods
            .leaseExtend({
            loadAmount: params.loadAmount,
            stateBump,
            leaseBump,
            walletBumps: Buffer.from(walletBumps),
        })
            .accounts({
            lease: leaseAccount.publicKey,
            aggregator,
            queue,
            funder: params.funder,
            owner: params.funderAuthority.publicKey,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            escrow,
            programState: programStateAccount.publicKey,
            mint: (await queueAccount.loadMint()).publicKey,
        })
            .signers([params.funderAuthority])
            .remainingAccounts(jobPubkeys.concat(jobWallets).map((pubkey) => {
            return { isSigner: false, isWritable: true, pubkey };
        }))
            .rpc();
    }
    /**
     * Withdraw funds from a LeaseAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     */
    async withdraw(params) {
        const program = this.program;
        const lease = await this.loadData();
        const escrow = lease.escrow;
        const queue = lease.queue;
        const queueAccount = new OracleQueueAccount({ program, publicKey: queue });
        const aggregator = lease.aggregator;
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const switchTokenMint = await queueAccount.loadMint();
        const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(program, queueAccount, new AggregatorAccount({ program, publicKey: aggregator }));
        return await program.methods
            .leaseWithdraw({
            amount: params.amount,
            stateBump,
            leaseBump,
        })
            .accounts({
            lease: leaseAccount.publicKey,
            escrow,
            aggregator,
            queue,
            withdrawAuthority: params.withdrawAuthority.publicKey,
            withdrawAccount: params.withdrawWallet,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            programState: programStateAccount.publicKey,
            mint: (await queueAccount.loadMint()).publicKey,
        })
            .signers([params.withdrawAuthority])
            .rpc();
    }
}
exports.LeaseAccount = LeaseAccount;
/**
 * Row structure of elements in the crank.
 */
class CrankRow {
    static from(buf) {
        const pubkey = new web3_js_1.PublicKey(buf.slice(0, 32));
        const nextTimestamp = new anchor.BN(buf.slice(32, 40), "le");
        const res = new CrankRow();
        res.pubkey = pubkey;
        res.nextTimestamp = nextTimestamp;
        return res;
    }
}
exports.CrankRow = CrankRow;
/**
 * A Switchboard account representing a crank of aggregators ordered by next update time.
 */
class CrankAccount {
    /**
     * CrankAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Load and parse CrankAccount data based on the program IDL.
     * @return CrankAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        var _a, _b;
        const crank = await this.program.account.crankAccountData.fetch(this.publicKey);
        const pqData = [];
        const buffer = (_b = (_a = (await this.program.provider.connection.getAccountInfo(crank.dataBuffer))) === null || _a === void 0 ? void 0 : _a.data.slice(8)) !== null && _b !== void 0 ? _b : Buffer.from("");
        const rowSize = 40;
        for (let i = 0; i < crank.pqSize * rowSize; i += rowSize) {
            if (buffer.length - i < rowSize) {
                break;
            }
            const rowBuf = buffer.slice(i, i + rowSize);
            pqData.push(CrankRow.from(rowBuf));
        }
        crank.pqData = pqData;
        crank.ebuf = undefined;
        return crank;
    }
    /**
     * Get the size of a CrankAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.crankAccountData.size;
    }
    /**
     * Create and initialize the CrankAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated CrankAccount.
     */
    static async create(program, params) {
        var _a, _b, _c;
        const payerKeypair = programWallet(program);
        const crankAccount = anchor.web3.Keypair.generate();
        const buffer = anchor.web3.Keypair.generate();
        const size = program.account.crankAccountData.size;
        params.maxRows = (_a = params.maxRows) !== null && _a !== void 0 ? _a : 500;
        const crankSize = params.maxRows * 40 + 8;
        await program.methods
            .crankInit({
            name: ((_b = params.name) !== null && _b !== void 0 ? _b : Buffer.from("")).slice(0, 32),
            metadata: ((_c = params.metadata) !== null && _c !== void 0 ? _c : Buffer.from("")).slice(0, 64),
            crankSize: params.maxRows,
        })
            .accounts({
            crank: crankAccount.publicKey,
            queue: params.queueAccount.publicKey,
            buffer: buffer.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            payer: programWallet(program).publicKey,
        })
            .signers([crankAccount, buffer])
            .preInstructions([
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: programWallet(program).publicKey,
                newAccountPubkey: buffer.publicKey,
                space: crankSize,
                lamports: await program.provider.connection.getMinimumBalanceForRentExemption(crankSize),
                programId: program.programId,
            }),
        ])
            .rpc();
        return new CrankAccount({ program, keypair: crankAccount });
    }
    /**
     * Pushes a new aggregator onto the crank.
     * @param aggregator The Aggregator account to push on the crank.
     * @return TransactionSignature
     */
    async push(params) {
        const aggregatorAccount = params.aggregatorAccount;
        const crank = await this.loadData();
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: crank.queuePubkey,
        });
        const queue = await queueAccount.loadData();
        const queueAuthority = queue.authority;
        const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(this.program, queueAccount, aggregatorAccount);
        let lease = null;
        try {
            lease = await leaseAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested lease pda account has not been initialized.");
        }
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, aggregatorAccount.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested permission pda account has not been initialized.");
        }
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        return await this.program.methods
            .crankPush({
            stateBump,
            permissionBump,
        })
            .accounts({
            crank: this.publicKey,
            aggregator: aggregatorAccount.publicKey,
            oracleQueue: queueAccount.publicKey,
            queueAuthority,
            permission: permissionAccount.publicKey,
            lease: leaseAccount.publicKey,
            escrow: lease.escrow,
            programState: programStateAccount.publicKey,
            dataBuffer: crank.dataBuffer,
        })
            .rpc();
    }
    /**
     * Pops an aggregator from the crank.
     * @param params
     * @return TransactionSignature
     */
    async popTxn(params) {
        var _a, _b, _c, _d, _e;
        const failOpenOnAccountMismatch = (_a = params.failOpenOnMismatch) !== null && _a !== void 0 ? _a : false;
        const next = (_b = params.readyPubkeys) !== null && _b !== void 0 ? _b : (await this.peakNextReady(5));
        if (next.length === 0) {
            throw new Error("Crank is not ready to be turned.");
        }
        const remainingAccounts = [];
        const leaseBumpsMap = new Map();
        const permissionBumpsMap = new Map();
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: params.queuePubkey,
        });
        for (const row of next) {
            const aggregatorAccount = new AggregatorAccount({
                program: this.program,
                publicKey: row,
            });
            const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(this.program, queueAccount, aggregatorAccount);
            const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, params.queueAuthority, params.queuePubkey, row);
            const escrow = await spl.Token.getAssociatedTokenAddress(spl.ASSOCIATED_TOKEN_PROGRAM_ID, spl.TOKEN_PROGRAM_ID, params.tokenMint, leaseAccount.publicKey, true);
            remainingAccounts.push(aggregatorAccount.publicKey);
            remainingAccounts.push(leaseAccount.publicKey);
            remainingAccounts.push(escrow);
            remainingAccounts.push(permissionAccount.publicKey);
            leaseBumpsMap.set(row.toBase58(), leaseBump);
            permissionBumpsMap.set(row.toBase58(), permissionBump);
        }
        remainingAccounts.sort((a, b) => a.toBuffer().compare(b.toBuffer()));
        const crank = params.crank;
        const queue = params.queue;
        const leaseBumps = [];
        const permissionBumps = [];
        // Map bumps to the index of their corresponding feeds.
        for (const key of remainingAccounts) {
            leaseBumps.push((_c = leaseBumpsMap.get(key.toBase58())) !== null && _c !== void 0 ? _c : 0);
            permissionBumps.push((_d = permissionBumpsMap.get(key.toBase58())) !== null && _d !== void 0 ? _d : 0);
        }
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const payerKeypair = programWallet(this.program);
        let mint = queue.mint;
        if (mint.equals(web3_js_1.PublicKey.default)) {
            mint = spl.NATIVE_MINT;
        }
        // const promises: Array<Promise<TransactionSignature>> = [];
        return await this.program.methods
            .crankPop({
            stateBump,
            leaseBumps: Buffer.from(leaseBumps),
            permissionBumps: Buffer.from(permissionBumps),
            nonce: (_e = params.nonce) !== null && _e !== void 0 ? _e : null,
            failOpenOnAccountMismatch,
        })
            .accounts({
            crank: this.publicKey,
            oracleQueue: params.queuePubkey,
            queueAuthority: params.queueAuthority,
            programState: programStateAccount.publicKey,
            payoutWallet: params.payoutWallet,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            crankDataBuffer: crank.dataBuffer,
            queueDataBuffer: queue.dataBuffer,
            mint,
        })
            .remainingAccounts(remainingAccounts.map((pubkey) => {
            return { isSigner: false, isWritable: true, pubkey };
        }))
            .signers([payerKeypair])
            .transaction();
    }
    /**
     * Pops an aggregator from the crank.
     * @param params
     * @return TransactionSignature
     */
    async pop(params) {
        const payerKeypair = programWallet(this.program);
        return await web3_js_1.sendAndConfirmTransaction(this.program.provider.connection, await this.popTxn(params), [payerKeypair]);
    }
    /**
     * Get an array of the next aggregator pubkeys to be popped from the crank, limited by n
     * @param n The limit of pubkeys to return.
     * @return Pubkey list of Aggregators and next timestamp to be popped, ordered by timestamp.
     */
    async peakNextWithTime(n) {
        let crank = await this.loadData();
        let items = crank.pqData
            .slice(0, crank.pqSize)
            .sort((a, b) => a.nextTimestamp.sub(b.nextTimestamp))
            .slice(0, n);
        return items;
    }
    /**
     * Get an array of the next readily updateable aggregator pubkeys to be popped
     * from the crank, limited by n
     * @param n The limit of pubkeys to return.
     * @return Pubkey list of Aggregator pubkeys.
     */
    async peakNextReady(n) {
        const now = Math.floor(+new Date() / 1000);
        let crank = await this.loadData();
        n = n !== null && n !== void 0 ? n : crank.pqSize;
        let items = crank.pqData
            .slice(0, crank.pqSize)
            .filter((row) => now >= row.nextTimestamp.toNumber())
            .sort((a, b) => a.nextTimestamp.sub(b.nextTimestamp))
            .slice(0, n)
            .map((item) => item.pubkey);
        return items;
    }
    /**
     * Get an array of the next aggregator pubkeys to be popped from the crank, limited by n
     * @param n The limit of pubkeys to return.
     * @return Pubkey list of Aggregators next up to be popped.
     */
    async peakNext(n) {
        let crank = await this.loadData();
        let items = crank.pqData
            .slice(0, crank.pqSize)
            .sort((a, b) => a.nextTimestamp.sub(b.nextTimestamp))
            .map((item) => item.pubkey)
            .slice(0, n);
        return items;
    }
}
exports.CrankAccount = CrankAccount;
/**
 * A Switchboard account representing an oracle account and its associated queue
 * and escrow account.
 */
class OracleAccount {
    /**
     * OracleAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Load and parse OracleAccount data based on the program IDL.
     * @return OracleAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const item = await this.program.account.oracleAccountData.fetch(this.publicKey);
        item.ebuf = undefined;
        return item;
    }
    /**
     * Get the size of an OracleAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.oracleAccountData.size;
    }
    /**
     * Create and initialize the OracleAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated OracleAccount.
     */
    static async create(program, params) {
        var _a, _b, _c;
        const payerKeypair = programWallet(program);
        const authorityKeypair = (_a = params.oracleAuthority) !== null && _a !== void 0 ? _a : payerKeypair;
        const size = program.account.oracleAccountData.size;
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const mint = await params.queueAccount.loadMint();
        const wallet = await mint.createAccount(programWallet(program).publicKey);
        await mint.setAuthority(wallet, programStateAccount.publicKey, "AccountOwner", payerKeypair, []);
        const [oracleAccount, oracleBump] = OracleAccount.fromSeed(program, params.queueAccount, wallet);
        await program.methods
            .oracleInit({
            name: ((_b = params.name) !== null && _b !== void 0 ? _b : Buffer.from("")).slice(0, 32),
            metadata: ((_c = params.metadata) !== null && _c !== void 0 ? _c : Buffer.from("")).slice(0, 128),
            stateBump,
            oracleBump,
        })
            .accounts({
            oracle: oracleAccount.publicKey,
            oracleAuthority: authorityKeypair.publicKey,
            queue: params.queueAccount.publicKey,
            wallet,
            programState: programStateAccount.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            payer: programWallet(program).publicKey,
        })
            .rpc();
        return new OracleAccount({ program, publicKey: oracleAccount.publicKey });
    }
    static decode(program, accountInfo) {
        const coder = new anchor.BorshAccountsCoder(program.idl);
        const key = "OracleAccountData";
        const data = coder.decode(key, accountInfo === null || accountInfo === void 0 ? void 0 : accountInfo.data);
        return data;
    }
    /**
     * Constructs OracleAccount from the static seed from which it was generated.
     * @return OracleAccount and PDA bump tuple.
     */
    static fromSeed(program, queueAccount, wallet) {
        const [oraclePubkey, oracleBump] = anchor.utils.publicKey.findProgramAddressSync([
            Buffer.from("OracleAccountData"),
            queueAccount.publicKey.toBuffer(),
            wallet.toBuffer(),
        ], program.programId);
        return [
            new OracleAccount({ program, publicKey: oraclePubkey }),
            oracleBump,
        ];
    }
    /**
     * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
     * @return TransactionSignature.
     */
    async heartbeat(authority) {
        const payerKeypair = programWallet(this.program);
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: (await this.loadData()).queuePubkey,
        });
        const queue = await queueAccount.loadData();
        let lastPubkey = this.publicKey;
        if (queue.size !== 0) {
            lastPubkey = queue.queue[queue.gcIdx];
        }
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queue.authority, queueAccount.publicKey, this.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested permission pda account has not been initialized.");
        }
        const oracle = await this.loadData();
        assert(this.publicKey !== undefined);
        assert(payerKeypair.publicKey !== undefined);
        assert(oracle.tokenAccount !== undefined);
        assert(lastPubkey !== undefined);
        assert(queueAccount.publicKey !== undefined);
        assert(queueAccount.publicKey !== undefined);
        assert(permissionAccount.publicKey !== undefined);
        assert(queue.dataBuffer !== undefined);
        return await this.program.methods
            .oracleHeartbeat({
            permissionBump,
        })
            .accounts({
            oracle: this.publicKey,
            oracleAuthority: payerKeypair.publicKey,
            tokenAccount: oracle.tokenAccount,
            gcOracle: lastPubkey,
            oracleQueue: queueAccount.publicKey,
            permission: permissionAccount.publicKey,
            dataBuffer: queue.dataBuffer,
        })
            .signers([authority])
            .rpc();
    }
    /**
    /**
     * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
     * @return TransactionSignature.
     */
    async heartbeatTx() {
        const payerKeypair = programWallet(this.program);
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: (await this.loadData()).queuePubkey,
        });
        const queue = await queueAccount.loadData();
        let lastPubkey = this.publicKey;
        if (queue.size !== 0) {
            lastPubkey = queue.queue[queue.gcIdx];
        }
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queue.authority, queueAccount.publicKey, this.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested permission pda account has not been initialized.");
        }
        const oracle = await this.loadData();
        return this.program.methods
            .oracleHeartbeat({
            permissionBump,
        })
            .accounts({
            oracle: this.publicKey,
            oracleAuthority: payerKeypair.publicKey,
            tokenAccount: oracle.tokenAccount,
            gcOracle: lastPubkey,
            oracleQueue: queueAccount.publicKey,
            permission: permissionAccount.publicKey,
            dataBuffer: queue.dataBuffer,
        })
            .signers([this.keypair])
            .transaction();
    }
    /**
     * Withdraw stake and/or rewards from an OracleAccount.
     */
    async withdraw(params) {
        const payerKeypair = programWallet(this.program);
        const oracle = await this.loadData();
        const queuePubkey = oracle.queuePubkey;
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: queuePubkey,
        });
        const queueAuthority = (await queueAccount.loadData()).authority;
        const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, this.publicKey);
        return await this.program.methods
            .oracleWithdraw({
            permissionBump,
            stateBump,
            amount: params.amount,
        })
            .accounts({
            oracle: this.publicKey,
            oracleAuthority: params.oracleAuthority.publicKey,
            tokenAccount: oracle.tokenAccount,
            withdrawAccount: params.withdrawAccount,
            oracleQueue: queueAccount.publicKey,
            permission: permissionAccount.publicKey,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            programState: stateAccount.publicKey,
            systemProgram: web3_js_1.SystemProgram.programId,
            payer: programWallet(this.program).publicKey,
        })
            .signers([params.oracleAuthority])
            .rpc();
    }
    async getBalance() {
        const oracle = await this.loadData();
        const escrowInfo = await this.program.provider.connection.getAccountInfo(oracle.tokenAccount);
        const data = Buffer.from(escrowInfo.data);
        const accountInfo = spl.AccountLayout.decode(data);
        const balance = spl.u64.fromBuffer(accountInfo.amount).toNumber();
        return balance; // / mintInfo.decimals;
    }
}
exports.OracleAccount = OracleAccount;
/**
 * A Switchboard VRF account.
 */
class VrfAccount {
    /**
     * CrankAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Load and parse VrfAccount data based on the program IDL.
     * @return VrfAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const vrf = await this.program.account.vrfAccountData.fetch(this.publicKey);
        vrf.ebuf = undefined;
        vrf.builders = vrf.builders.slice(0, vrf.buildersLen);
        return vrf;
    }
    /**
     * Get the size of a VrfAccount on chain.
     * @return size.
     */
    size() {
        return this.program.account.vrfAccountData.size;
    }
    /**
     * Create and initialize the VrfAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated VrfAccount.
     */
    static async create(program, params) {
        var _a;
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const keypair = params.keypair;
        const size = program.account.vrfAccountData.size;
        const switchTokenMint = await params.queue.loadMint();
        const escrow = await spl.Token.getAssociatedTokenAddress(switchTokenMint.associatedProgramId, switchTokenMint.programId, switchTokenMint.publicKey, keypair.publicKey, true);
        try {
            await switchTokenMint.createAssociatedTokenAccountInternal(keypair.publicKey, escrow);
        }
        catch (e) {
            console.log(e);
        }
        await switchTokenMint.setAuthority(escrow, programStateAccount.publicKey, "AccountOwner", keypair, []);
        await program.methods
            .vrfInit({
            stateBump,
            callback: params.callback,
        })
            .accounts({
            vrf: keypair.publicKey,
            escrow,
            authority: (_a = params.authority) !== null && _a !== void 0 ? _a : keypair.publicKey,
            oracleQueue: params.queue.publicKey,
            programState: programStateAccount.publicKey,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
        })
            .preInstructions([
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: programWallet(program).publicKey,
                newAccountPubkey: keypair.publicKey,
                space: size,
                lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                programId: program.programId,
            }),
        ])
            .signers([keypair])
            .rpc();
        return new VrfAccount({ program, keypair, publicKey: keypair.publicKey });
    }
    /**
     * Set the callback CPI when vrf verification is successful.
     */
    // async setCallback(
    // params: VrfSetCallbackParams
    // ): Promise<TransactionSignature> {
    // return await this.program.rpc.vrfSetCallback(params, {
    // accounts: {
    // vrf: this.publicKey,
    // authority: params.authority.publicKey,
    // },
    // signers: [params.authority],
    // });
    // }
    /**
     * Trigger new randomness production on the vrf account
     */
    async requestRandomness(params) {
        const vrf = await this.loadData();
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: vrf.oracleQueue,
        });
        const queue = await queueAccount.loadData();
        const queueAuthority = queue.authority;
        const dataBuffer = queue.dataBuffer;
        const escrow = vrf.escrow;
        const payer = params.payer;
        const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, this.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested permission pda account has not been initialized.");
        }
        const tokenProgram = spl.TOKEN_PROGRAM_ID;
        const recentBlockhashes = web3_js_1.SYSVAR_RECENT_BLOCKHASHES_PUBKEY;
        await this.program.methods
            .vrfRequestRandomness({
            stateBump,
            permissionBump,
        })
            .accounts({
            authority: params.authority.publicKey,
            vrf: this.publicKey,
            oracleQueue: queueAccount.publicKey,
            queueAuthority,
            dataBuffer,
            permission: permissionAccount.publicKey,
            escrow,
            payerWallet: payer,
            payerAuthority: params.payerAuthority.publicKey,
            recentBlockhashes,
            programState: stateAccount.publicKey,
            tokenProgram,
        })
            .signers([params.authority, params.payerAuthority])
            .rpc();
    }
    async prove(params) {
        const vrf = await this.loadData();
        let idx = -1;
        let producerKey = web3_js_1.PublicKey.default;
        for (idx = 0; idx < vrf.buildersLen; ++idx) {
            const builder = vrf.builders[idx];
            producerKey = builder.producer;
            if (producerKey.equals(params.oracleAccount.publicKey)) {
                break;
            }
        }
        if (idx === vrf.buildersLen) {
            throw new Error("OracleProofRequestNotFoundError");
        }
        return await this.program.methods
            .vrfProve({
            proof: params.proof,
            idx,
        })
            .accounts({
            vrf: this.publicKey,
            oracle: producerKey,
            randomnessProducer: params.oracleAuthority.publicKey,
        })
            .signers([params.oracleAuthority])
            .rpc();
    }
    async verify(oracle, tryCount = 278) {
        const skipPreflight = true;
        const txs = [];
        const vrf = await this.loadData();
        const idx = vrf.builders.find((builder) => oracle.publicKey.equals(builder.producer));
        if (idx === -1) {
            throw new Error("OracleNotFoundError");
        }
        let counter = 0;
        const remainingAccounts = vrf.callback.accounts.slice(0, vrf.callback.accountsLen);
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const oracleData = await oracle.loadData();
        const oracleWallet = oracleData.tokenAccount;
        const oracleAuthority = oracleData.oracleAuthority;
        let instructions = [];
        let tx = new web3_js_1.Transaction();
        for (let i = 0; i < tryCount; ++i) {
            txs.push({
                tx: await this.program.methods
                    .vrfVerify({
                    nonce: i,
                    stateBump,
                    idx,
                })
                    .accounts({
                    vrf: this.publicKey,
                    callbackPid: vrf.callback.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    escrow: vrf.escrow,
                    programState: programStateAccount.publicKey,
                    oracle: oracle.publicKey,
                    oracleAuthority,
                    oracleWallet,
                    instructionsSysvar: web3_js_1.SYSVAR_INSTRUCTIONS_PUBKEY,
                })
                    .remainingAccounts(remainingAccounts)
                    .transaction(),
            });
            // try {
            // tx.add(newTx);
            // } catch (e) {
            // txs.push({ tx });
            // tx = newTx;
            // }
            // txs.push(newTx);
        }
        // txs.push({ tx });
        return sendAll(this.program.provider, txs, [], skipPreflight);
    }
    /**
     * Attempt the maximum amount of turns remaining on the vrf verify crank.
     * This will automatically call the vrf callback (if set) when completed.
     */
    async proveAndVerify(params, tryCount = 278) {
        const skipPreflight = params.skipPreflight;
        const oracle = params.oracleAccount;
        const txs = [];
        const vrf = await this.loadData();
        const idx = vrf.builders.find((builder) => oracle.publicKey.equals(builder.producer));
        if (idx === -1) {
            throw new Error("OracleNotFoundError");
        }
        let counter = 0;
        const remainingAccounts = vrf.callback.accounts.slice(0, vrf.callback.accountsLen);
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const oracleData = await oracle.loadData();
        const oracleWallet = oracleData.tokenAccount;
        const oracleAuthority = oracleData.oracleAuthority;
        let instructions = [];
        let tx = new web3_js_1.Transaction();
        for (let i = 0; i < tryCount; ++i) {
            txs.push({
                tx: await this.program.methods
                    .vrfProveAndVerify({
                    nonce: i,
                    stateBump,
                    idx,
                    proof: params.proof,
                })
                    .accounts({
                    vrf: this.publicKey,
                    callbackPid: vrf.callback.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    escrow: vrf.escrow,
                    programState: programStateAccount.publicKey,
                    oracle: oracle.publicKey,
                    oracleAuthority,
                    oracleWallet,
                    instructionsSysvar: web3_js_1.SYSVAR_INSTRUCTIONS_PUBKEY,
                })
                    .remainingAccounts(remainingAccounts)
                    .signers([params.oracleAuthority])
                    .transaction(),
            });
            // try {
            // tx.add(newTx);
            // } catch (e) {
            // txs.push({ tx });
            // tx = newTx;
            // }
            // txs.push(newTx);
        }
        // txs.push({ tx });
        return sendAll(this.program.provider, txs, [params.oracleAuthority], skipPreflight);
    }
}
exports.VrfAccount = VrfAccount;
class BufferRelayerAccount {
    /**
     * CrankAccount constructor
     * @param params initialization params.
     */
    constructor(params) {
        var _a;
        if (params.keypair === undefined && params.publicKey === undefined) {
            throw new Error(`${this.constructor.name}: User must provide either a publicKey or keypair for account use.`);
        }
        if (params.keypair !== undefined && params.publicKey !== undefined) {
            if (!params.publicKey.equals(params.keypair.publicKey)) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Load and parse BufferRelayerAccount data based on the program IDL.
     * @return BufferRelayerAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const data = await this.program.account.bufferRelayerAccountData.fetch(this.publicKey);
        data.ebuf = undefined;
        return data;
    }
    size() {
        return 4092;
    }
    static async create(program, params) {
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
        const switchTokenMint = await params.queueAccount.loadMint();
        const keypair = web3_js_1.Keypair.generate();
        const escrow = await spl.Token.getAssociatedTokenAddress(spl.ASSOCIATED_TOKEN_PROGRAM_ID, spl.TOKEN_PROGRAM_ID, switchTokenMint.publicKey, keypair.publicKey);
        const size = 2048;
        const payer = programWallet(program);
        await program.rpc.bufferRelayerInit({
            name: params.name.slice(0, 32),
            minUpdateDelaySeconds: params.minUpdateDelaySeconds,
            stateBump,
        }, {
            accounts: {
                bufferRelayer: keypair.publicKey,
                escrow,
                authority: params.authority,
                queue: params.queueAccount.publicKey,
                job: params.jobAccount.publicKey,
                programState: programStateAccount.publicKey,
                mint: switchTokenMint.publicKey,
                payer: payer.publicKey,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
                associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
                rent: new web3_js_1.PublicKey("SysvarRent111111111111111111111111111111111"),
            },
            instructions: [
                anchor.web3.SystemProgram.createAccount({
                    fromPubkey: programWallet(program).publicKey,
                    newAccountPubkey: keypair.publicKey,
                    space: size,
                    lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                    programId: program.programId,
                }),
            ],
            signers: [keypair],
        });
        return new BufferRelayerAccount({ program, keypair });
    }
    async openRound() {
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const relayerData = await this.loadData();
        const queue = relayerData.queuePubkey;
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: queue,
        });
        const switchTokenMint = await queueAccount.loadMint();
        await switchTokenMint.getOrCreateAssociatedAccountInfo(programWallet(this.program).publicKey);
        const source = await spl.Token.getAssociatedTokenAddress(spl.ASSOCIATED_TOKEN_PROGRAM_ID, spl.TOKEN_PROGRAM_ID, switchTokenMint.publicKey, programWallet(this.program).publicKey, true);
        const bufferRelayer = this.publicKey;
        const escrow = relayerData.escrow;
        const queueData = await queueAccount.loadData();
        const queueAuthority = queueData.authority;
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, this.publicKey);
        const payer = programWallet(this.program);
        const transferIx = spl.Token.createTransferInstruction(spl.TOKEN_PROGRAM_ID, source, escrow, programWallet(this.program).publicKey, [], queueData.reward.toNumber());
        const openRoundIx = this.program.instruction.bufferRelayerOpenRound({
            stateBump,
            permissionBump,
        }, {
            accounts: {
                bufferRelayer,
                oracleQueue: queueAccount.publicKey,
                dataBuffer: queueData.dataBuffer,
                queueAuthority: queueData.authority,
                permission: permissionAccount.publicKey,
                escrow,
                programState: programStateAccount.publicKey,
                job: relayerData.jobPubkey,
            },
        });
        const tx = new web3_js_1.Transaction();
        tx.add(transferIx);
        tx.add(openRoundIx);
        const connection = this.program.provider
            .connection;
        return await web3_js_1.sendAndConfirmTransaction(connection, tx, [
            programWallet(this.program),
        ]);
    }
    async saveResult(params) {
        const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(this.program);
        const relayerData = await this.loadData();
        const queue = new web3_js_1.PublicKey(relayerData.queuePubkey);
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: queue,
        });
        const bufferRelayer = this.publicKey;
        const escrow = relayerData.escrow;
        const queueData = await queueAccount.loadData();
        const queueAuthority = queueData.authority;
        const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, this.publicKey);
        const oracleAccount = new OracleAccount({
            program: this.program,
            publicKey: relayerData.currentRound.oraclePubkey,
        });
        const oracleData = await oracleAccount.loadData();
        console.log("!!!!");
        return await this.program.rpc.bufferRelayerSaveResult({
            stateBump,
            permissionBump,
            result: params.result,
            success: params.success,
        }, {
            accounts: {
                bufferRelayer,
                oracleAuthority: params.oracleAuthority.publicKey,
                oracle: relayerData.currentRound.oraclePubkey,
                oracleQueue: queueAccount.publicKey,
                dataBuffer: queueData.dataBuffer,
                queueAuthority: queueData.authority,
                permission: permissionAccount.publicKey,
                escrow,
                programState: programStateAccount.publicKey,
                oracleWallet: oracleData.tokenAccount,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
            },
        });
    }
}
exports.BufferRelayerAccount = BufferRelayerAccount;
async function sendAll(provider, reqs, signers, skipPreflight) {
    let res = [];
    try {
        const opts = provider.opts;
        // TODO: maybe finalized
        const blockhash = await provider.connection.getLatestBlockhash("confirmed");
        let txs = reqs.map((r) => {
            if (r === null || r === undefined)
                return new web3_js_1.Transaction();
            let tx = r.tx;
            let signers = r.signers;
            if (signers === undefined) {
                signers = [];
            }
            tx.feePayer = provider.wallet.publicKey;
            tx.recentBlockhash = blockhash.blockhash;
            signers
                .filter((s) => s !== undefined)
                .forEach((kp) => {
                tx.partialSign(kp);
            });
            return tx;
        });
        txs = await packTransactions(provider.connection, txs, signers, provider.wallet.publicKey);
        const signedTxs = await provider.wallet.signAllTransactions(txs);
        const promises = [];
        for (let k = 0; k < txs.length; k += 1) {
            const tx = signedTxs[k];
            const rawTx = tx.serialize();
            promises.push(provider.connection.sendRawTransaction(rawTx, {
                skipPreflight,
                maxRetries: 10,
            }));
        }
        return Promise.all(promises);
    }
    catch (e) {
        console.log(e);
    }
    return res;
}
exports.sendAll = sendAll;
/**
 * Pack instructions into transactions as tightly as possible
 * @param instructions Instructions or Grouping of Instructions to pack down into transactions.
 * Arrays of instructions will be grouped into the same tx.
 * NOTE: this will break if grouping is too large for a single tx
 * @param feePayer Optional feepayer
 * @param recentBlockhash Optional blockhash
 * @returns Transaction[]
 */
function packInstructions(instructions, feePayer = web3_js_1.PublicKey.default, recentBlockhash = web3_js_1.PublicKey.default.toBase58()) {
    const packed = [];
    let currentTransaction = new web3_js_1.Transaction();
    currentTransaction.recentBlockhash = recentBlockhash;
    currentTransaction.feePayer = feePayer;
    const encodeLength = (bytes, len) => {
        let rem_len = len;
        for (;;) {
            let elem = rem_len & 0x7f;
            rem_len >>= 7;
            if (rem_len == 0) {
                bytes.push(elem);
                break;
            }
            else {
                elem |= 0x80;
                bytes.push(elem);
            }
        }
    };
    for (let ixGroup of instructions) {
        let ixs = Array.isArray(ixGroup) ? ixGroup : [ixGroup];
        for (let ix of ixs) {
            // add the new transaction
            currentTransaction.add(ix);
        }
        let sigCount = [];
        encodeLength(sigCount, currentTransaction.signatures.length);
        if (anchor.web3.PACKET_DATA_SIZE <=
            currentTransaction.serializeMessage().length +
                currentTransaction.signatures.length * 64 +
                sigCount.length) {
            // If the aggregator transaction fits, it will serialize without error. We can then push it ahead no problem
            const trimmedInstructions = ixs
                .map(() => currentTransaction.instructions.pop())
                .reverse();
            // Every serialize adds the instruction signatures as dependencies
            currentTransaction.signatures = [];
            const overflowInstructions = trimmedInstructions;
            // add the capped transaction to our transaction - only push it if it works
            packed.push(currentTransaction);
            currentTransaction = new web3_js_1.Transaction();
            currentTransaction.recentBlockhash = recentBlockhash;
            currentTransaction.feePayer = feePayer;
            currentTransaction.instructions = overflowInstructions;
            let newsc = [];
            encodeLength(newsc, currentTransaction.signatures.length);
            if (anchor.web3.PACKET_DATA_SIZE <=
                currentTransaction.serializeMessage().length +
                    currentTransaction.signatures.length * 64 +
                    newsc.length) {
                throw new Error("Instruction packing error: a grouping of instructions must be able to fit into a single transaction");
            }
        }
    }
    packed.push(currentTransaction);
    return packed;
}
exports.packInstructions = packInstructions;
/**
 * Repack Transactions and sign them
 * @param connection Web3.js Connection
 * @param transactions Transactions to repack
 * @param signers Signers for each transaction
 */
async function packTransactions(connection, transactions, signers, feePayer) {
    const instructions = transactions.map((t) => t.instructions).flat();
    const txs = packInstructions(instructions, feePayer);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    txs.forEach((t) => {
        t.recentBlockhash = blockhash;
    });
    return signTransactions(txs, signers);
}
exports.packTransactions = packTransactions;
/**
 * Sign transactions with correct signers
 * @param transactions array of transactions to sign
 * @param signers array of keypairs to sign the array of transactions with
 * @returns transactions signed
 */
function signTransactions(transactions, signers) {
    // Sign with all the appropriate signers
    for (let transaction of transactions) {
        // Get pubkeys of signers needed
        const sigsNeeded = transaction.instructions
            .map((instruction) => {
            const signers = instruction.keys.filter((meta) => meta.isSigner);
            return signers.map((signer) => signer.pubkey);
        })
            .flat();
        // Get matching signers in our supplied array
        let currentSigners = signers.filter((signer) => Boolean(sigsNeeded.find((sig) => sig.equals(signer.publicKey))));
        // Sign all transactions
        for (let signer of currentSigners) {
            transaction.partialSign(signer);
        }
    }
    return transactions;
}
exports.signTransactions = signTransactions;
// Create mint with a pre-generated keypair.
async function createMint(connection, payer, mintAuthority, freezeAuthority, decimals, programId, mintAccount) {
    const tkn = new spl.Token(connection, mintAccount.publicKey, programId, payer);
    // Allocate memory for the account
    const balanceNeeded = await spl.Token.getMinBalanceRentForExemptMint(connection);
    const transaction = new web3_js_1.Transaction();
    transaction.add(web3_js_1.SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintAccount.publicKey,
        lamports: balanceNeeded,
        space: spl.MintLayout.span,
        programId,
    }));
    transaction.add(spl.Token.createInitMintInstruction(programId, mintAccount.publicKey, decimals, mintAuthority, freezeAuthority));
    // Send the two instructions
    await web3_js_1.sendAndConfirmTransaction(connection, transaction, [
        payer,
        mintAccount,
    ]);
    return tkn;
}
exports.createMint = createMint;
function programWallet(program) {
    return program.provider.wallet
        .payer;
}
exports.programWallet = programWallet;
function safeDiv(number_, denominator, decimals = 20) {
    const oldDp = big_js_1.default.DP;
    big_js_1.default.DP = decimals;
    const result = number_.div(denominator);
    big_js_1.default.DP = oldDp;
    return result;
}
//# sourceMappingURL=sbv2.js.map