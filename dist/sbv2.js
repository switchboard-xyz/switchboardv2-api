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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OracleAccount = exports.CrankAccount = exports.CrankRow = exports.LeaseAccount = exports.OracleQueueAccount = exports.PermissionAccount = exports.SwitchboardPermission = exports.JobAccount = exports.AggregatorAccount = exports.SwitchboardError = exports.ProgramStateAccount = exports.SwitchboardDecimal = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor = __importStar(require("@project-serum/anchor"));
const switchboard_api_1 = require("@switchboard-xyz/switchboard-api");
const crypto = __importStar(require("crypto"));
const spl = __importStar(require("@solana/spl-token"));
const big_js_1 = __importDefault(require("big.js"));
/**
 * Switchboard precisioned representation of numbers.
 * @param connection Solana network connection object.
 * @param address The address of the bundle auth account to parse.
 * @return BundleAuth
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
        let c = big.c
            .map((n) => new anchor.BN(n, 10))
            .reduce((res, n) => {
            res = res.mul(new anchor.BN(10, 10));
            res = res.add(new anchor.BN(n, 10));
            return res;
        });
        let scale = big.c.length - big.e - 1;
        c = c.mul(new anchor.BN(big.s, 10));
        return new SwitchboardDecimal(c, scale);
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
        const scale = new big_js_1.default(`1e-${this.scale}`);
        return new big_js_1.default(this.mantissa.toString()).times(scale);
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
            if (params.publicKey !== params.keypair.publicKey) {
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
    static async fromSeed(program) {
        const [statePubkey, stateBump] = await anchor.utils.publicKey.findProgramAddressSync([Buffer.from("SB_STATE_V1")], program.programId);
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
        const payerKeypair = web3_js_1.Keypair.fromSecretKey(this.program.provider.wallet.payer.secretKey);
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
    /**
     * Create and initialize the ProgramStateAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated ProgramStateAccount.
     */
    static async create(program, params) {
        const payerKeypair = web3_js_1.Keypair.fromSecretKey(program.provider.wallet.payer.secretKey);
        // TODO: save bump
        const [stateAccount, stateBump] = await ProgramStateAccount.fromSeed(program);
        // TODO: need to save this to change mint and lock minting
        const mintAuthority = anchor.web3.Keypair.generate();
        const decimals = 9;
        const mint = await spl.Token.createMint(program.provider.connection, payerKeypair, mintAuthority.publicKey, null, decimals, spl.TOKEN_PROGRAM_ID);
        const tokenVault = await mint.createAccount(program.provider.wallet.publicKey);
        await mint.mintTo(tokenVault, mintAuthority.publicKey, [mintAuthority], 100000000);
        await program.rpc.programInit({
            stateBump,
            decimals: new anchor.BN(decimals),
        }, {
            accounts: {
                state: stateAccount.publicKey,
                mintAuthority: mintAuthority.publicKey,
                tokenMint: mint.publicKey,
                vault: tokenVault,
                payer: program.provider.wallet.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
            },
        });
        return new ProgramStateAccount({
            program,
            publicKey: stateAccount.publicKey,
        });
    }
    /**
     * Transfer N tokens from the program vault to a specified account.
     * @param to The recipient of the vault tokens.
     * @param authority The vault authority required to sign the transfer tx.
     * @param params specifies the amount to transfer.
     * @return TransactionSignature
     */
    async vaultTransfer(to, authority, params) {
        const [statePubkey, stateBump] = await anchor.utils.publicKey.findProgramAddressSync([Buffer.from("SB_STATE_V1")], this.program.programId);
        const vault = (await this.loadData()).tokenVault;
        return await this.program.rpc.vaultTransfer({
            stateBump,
            amount: params.amount,
        }, {
            accounts: {
                state: statePubkey,
                to,
                vault,
                authority: this.program.provider.wallet.publicKey,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
            },
        });
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
            if (params.publicKey !== params.keypair.publicKey) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Returns the aggregator's ID buffer in a stringified format.
     * @param aggregator A preloaded aggregator object.
     * @return The name of the aggregator.
     */
    static getName(aggregator) {
        return Buffer.from(aggregator.id).toString("utf8");
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
    /**
     * Get the latest confirmed value stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed value
     */
    async getLatestValue(aggregator) {
        var _a, _b;
        aggregator = aggregator !== null && aggregator !== void 0 ? aggregator : (await this.loadData());
        if (((_b = (_a = aggregator.latestConfirmedRound) === null || _a === void 0 ? void 0 : _a.numSuccess) !== null && _b !== void 0 ? _b : 0) === 0) {
            throw new Error("Aggregator currently holds no value.");
        }
        const mantissa = aggregator.latestConfirmedRound.result.mantissa.toNumber();
        const scale = aggregator.latestConfirmedRound.result.scale.toNumber();
        return mantissa / Math.pow(10, scale);
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
                    pubkey: new OracleAccount({
                        program: this.program,
                        publicKey: aggregator.latestConfirmedRound.oraclePubkeysData[i],
                    }),
                    value: SwitchboardDecimal.from(aggregator.latestConfirmedRound.mediansData[i]).toBig(),
                });
            }
        }
        return results;
    }
    // TODO: allow passing cache
    /**
     * Produces a hash of all the jobs currently in the aggregator
     * @return hash of all the feed jobs.
     */
    async produceJobsHash() {
        // Remember, dont trust the hash listed. Hash exactly the job you will be performing.
        const jobs = await this.loadJobs();
        const hash = crypto.createHash("sha256");
        for (const job of jobs) {
            hash.update(switchboard_api_1.OracleJob.encodeDelimited(job).finish());
        }
        return hash;
    }
    /**
     * Load and deserialize all jobs stored in this aggregator
     * @return Array<OracleJob>
     */
    async loadJobs(aggregator) {
        const coder = new anchor.AccountsCoder(this.program.idl);
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
        var _a, _b, _c, _d;
        const aggregatorAccount = (_a = params.keypair) !== null && _a !== void 0 ? _a : anchor.web3.Keypair.generate();
        const size = program.account.aggregatorAccountData.size;
        await program.rpc.aggregatorInit({
            id: params.id,
            batchSize: params.batchSize,
            minOracleResults: params.minRequiredOracleResults,
            minJobResults: params.minRequiredJobResults,
            minUpdateDelaySeconds: params.minUpdateDelaySeconds,
            varianceThreshold: ((_b = params.varianceThreshold) !== null && _b !== void 0 ? _b : 0).toString(),
            forceReportPeriod: (_c = params.forceReportPeriod) !== null && _c !== void 0 ? _c : new anchor.BN(0),
            expiration: (_d = params.expiration) !== null && _d !== void 0 ? _d : new anchor.BN(0),
        }, {
            accounts: {
                aggregator: aggregatorAccount.publicKey,
            },
            signers: [aggregatorAccount],
            instructions: [
                anchor.web3.SystemProgram.createAccount({
                    fromPubkey: program.provider.wallet.publicKey,
                    newAccountPubkey: aggregatorAccount.publicKey,
                    space: size,
                    lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                    programId: program.programId,
                }),
            ],
        });
        return new AggregatorAccount({ program, keypair: aggregatorAccount });
    }
    /**
     * RPC to add a new job to an aggregtor to be performed on feed updates.
     * @param job JobAccount specifying another job for this aggregator to fulfill on update
     * @return TransactionSignature
     */
    async addJob(job) {
        return await this.program.rpc.aggregatorAddJob({}, {
            accounts: {
                aggregator: this.publicKey,
                job: job.publicKey,
            },
            signers: [this.keypair],
        });
    }
    /**
     * RPC to remove a job from an aggregtor.
     * @param job JobAccount to be removed from the aggregator
     * @return TransactionSignature
     */
    async removeJob(job) {
        return await this.program.rpc.aggregatorRemoveJob({}, {
            accounts: {
                aggregator: this.publicKey,
                job: job.publicKey,
            },
            signers: [this.keypair],
        });
    }
    /**
     * Opens a new round for the aggregator and will provide an incentivize reward
     * to the caller
     * @param params
     * @return TransactionSignature
     */
    async openRound(params) {
        const [stateAccount, stateBump] = await ProgramStateAccount.fromSeed(this.program);
        const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(this.program, params.oracleQueueAccount, this);
        try {
            await leaseAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested pda account has not been initialized.");
        }
        const escrowPubkey = (await leaseAccount.loadData()).escrow;
        const queue = await params.oracleQueueAccount.loadData();
        const queueAuthority = queue.authority;
        const [permissionAccount, permissionBump] = await PermissionAccount.fromSeed(this.program, queueAuthority, params.oracleQueueAccount.publicKey, this.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested pda account has not been initialized.");
        }
        return await this.program.rpc.aggregatorOpenRound({
            stateBump,
            leaseBump,
            permissionBump,
        }, {
            accounts: {
                aggregator: this.publicKey,
                lease: leaseAccount.publicKey,
                oracleQueue: params.oracleQueueAccount.publicKey,
                queueAuthority,
                permission: permissionAccount.publicKey,
                escrow: escrowPubkey,
                programState: stateAccount.publicKey,
                payoutWallet: params.payoutWallet,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
            },
        });
    }
    /**
     * RPC for an oracle to save a result to an aggregator round.
     * @param oracleAccount The oracle account submitting a result.
     * @param params
     * @return TransactionSignature
     */
    async saveResult(oracleAccount, // TODO: move to params.
    params) {
        let data = await this.loadData();
        return await this.program.rpc.aggregatorSaveResult({
            oracleIdx: params.oracleIdx,
            value: params.value.toString(),
            jobsHash: Buffer.from(""),
            minResponse: params.minResponse.toString(),
            maxResponse: params.maxResponse.toString(),
        }, {
            accounts: {
                aggregator: this.publicKey,
                oracle: oracleAccount.publicKey,
                oracleQueue: data.currentRound.oracleQueuePubkey,
            },
            signers: [oracleAccount.keypair],
        });
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
            if (params.publicKey !== params.keypair.publicKey) {
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
     * Load and parse JobAccount data based on the program IDL from a buffer.
     * @return JobAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    static decode(program, buf) {
        const typesCoder = new anchor.TypesCoder(program.idl);
        return typesCoder.decode("JobAccountData", buf);
    }
    /**
     * Create and initialize the JobAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated JobAccount.
     */
    static async create(program, params) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const jobAccount = (_a = params.keypair) !== null && _a !== void 0 ? _a : anchor.web3.Keypair.generate();
        const size = 212 + params.data.length + ((_d = (_c = (_b = params.variables) === null || _b === void 0 ? void 0 : _b.join("")) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0);
        await program.rpc.jobInit({
            id: (_e = params.id) !== null && _e !== void 0 ? _e : Buffer.from(""),
            expiration: (_f = params.expiration) !== null && _f !== void 0 ? _f : new anchor.BN(0),
            data: params.data,
            variables: (_h = (_g = params.variables) === null || _g === void 0 ? void 0 : _g.map((item) => Buffer.from(""))) !== null && _h !== void 0 ? _h : new Array(),
        }, {
            accounts: {
                job: jobAccount.publicKey,
            },
            signers: [jobAccount],
            instructions: [
                anchor.web3.SystemProgram.createAccount({
                    fromPubkey: program.provider.wallet.publicKey,
                    newAccountPubkey: jobAccount.publicKey,
                    space: size,
                    lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                    programId: program.programId,
                }),
            ],
        });
        return new JobAccount({ program, keypair: jobAccount });
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
})(SwitchboardPermission = exports.SwitchboardPermission || (exports.SwitchboardPermission = {}));
/**
 * A Switchboard account representing a permission or privilege granted by one
 * account signer to another account.
 */
class PermissionAccount {
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
            if (params.publicKey !== params.keypair.publicKey) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
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
        const [permissionAccount, permissionBump] = await PermissionAccount.fromSeed(program, params.authority, params.granter, params.grantee);
        await program.rpc.permissionInit({
            permissionBump,
        }, {
            accounts: {
                permission: permissionAccount.publicKey,
                authority: params.authority,
                granter: params.granter,
                grantee: params.grantee,
                systemProgram: web3_js_1.SystemProgram.programId,
                payer: program.provider.wallet.publicKey,
            },
            signers: [permissionAccount.keypair],
        });
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
    static async fromSeed(program, authority, granter, grantee) {
        const [pubkey, bump] = await anchor.utils.publicKey.findProgramAddressSync([
            Buffer.from("permission"),
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
        const permission = new Map();
        permission.set(params.permission.toString(), null);
        return await this.program.rpc.permissionSet({
            permission: Object.fromEntries(permission),
            enable: params.enable,
        }, {
            accounts: {
                permission: this.publicKey,
                authority: params.authority.publicKey,
            },
            signers: [params.authority],
        });
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
            if (params.publicKey !== params.keypair.publicKey) {
                throw new Error(`${this.constructor.name}: provided pubkey and keypair mismatch.`);
            }
        }
        this.program = params.program;
        this.keypair = params.keypair;
        this.publicKey = (_a = params.publicKey) !== null && _a !== void 0 ? _a : this.keypair.publicKey;
    }
    /**
     * Load and parse OracleQueueAccount data based on the program IDL.
     * @return OracleQueueAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    async loadData() {
        const queue = await this.program.account.oracleQueueAccountData.fetch(this.publicKey);
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
        var _a, _b, _c, _d, _e;
        const oracleQueueAccount = anchor.web3.Keypair.generate();
        const size = program.account.oracleQueueAccountData.size;
        await program.rpc.oracleQueueInit({
            id: (_a = params.id) !== null && _a !== void 0 ? _a : Buffer.from(""),
            metadata: (_b = params.metadata) !== null && _b !== void 0 ? _b : Buffer.from(""),
            slashingCurve: (_c = params.slashingCurve) !== null && _c !== void 0 ? _c : null,
            reward: (_d = params.reward) !== null && _d !== void 0 ? _d : new anchor.BN(0),
            minStake: (_e = params.minStake) !== null && _e !== void 0 ? _e : new anchor.BN(0),
            authority: params.authority,
        }, {
            accounts: {
                oracleQueue: oracleQueueAccount.publicKey,
            },
            signers: [oracleQueueAccount],
            instructions: [
                anchor.web3.SystemProgram.createAccount({
                    fromPubkey: program.provider.wallet.publicKey,
                    newAccountPubkey: oracleQueueAccount.publicKey,
                    space: size,
                    lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                    programId: program.programId,
                }),
            ],
        });
        return new OracleQueueAccount({ program, keypair: oracleQueueAccount });
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
            if (params.publicKey !== params.keypair.publicKey) {
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
    static async fromSeed(program, queueAccount, aggregatorAccount) {
        const [pubkey, bump] = await anchor.utils.publicKey.findProgramAddressSync([
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
        const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(program);
        const switchTokenMint = await programStateAccount.getTokenMint();
        const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(program, params.oracleQueueAccount, params.aggregatorAccount);
        // TODO: check on chain
        const escrow = await switchTokenMint.createAccount(leaseAccount.publicKey);
        // const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID: PublicKey = new PublicKey(
        // "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        // );
        // const escrowBump = (
        // await PublicKey.findProgramAddress(
        // [
        // leaseAccount.publicKey.toBuffer(),
        // spl.TOKEN_PROGRAM_ID.toBuffer(),
        // switchTokenMint.publicKey.toBuffer(),
        // ],
        // SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
        // )
        // )[1];
        await program.rpc.leaseInit({
            loadAmount: params.loadAmount,
            stateBump,
            leaseBump,
            // escrowBump,
        }, {
            accounts: {
                programState: programStateAccount.publicKey,
                lease: leaseAccount.publicKey,
                queue: params.oracleQueueAccount.publicKey,
                aggregator: params.aggregatorAccount.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
                funder: params.funder,
                payer: program.provider.wallet.publicKey,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
                escrow,
                owner: params.funderAuthority.publicKey,
            },
            signers: [params.funderAuthority],
        });
        return new LeaseAccount({ program, publicKey: leaseAccount.publicKey });
    }
}
exports.LeaseAccount = LeaseAccount;
/**
 * Row structure of elements in the crank.
 */
class CrankRow {
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
            if (params.publicKey !== params.keypair.publicKey) {
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
        const lease = await this.program.account.crankAccountData.fetch(this.publicKey);
        lease.ebuf = undefined;
        return lease;
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
        var _a, _b;
        const crankAccount = anchor.web3.Keypair.generate();
        const size = program.account.crankAccountData.size;
        await program.rpc.crankInit({
            id: (_a = params.id) !== null && _a !== void 0 ? _a : Buffer.from(""),
            metadata: (_b = params.metadata) !== null && _b !== void 0 ? _b : Buffer.from(""),
            queuePubkey: params.queueAccount.publicKey,
        }, {
            accounts: {
                crank: crankAccount.publicKey,
            },
            signers: [crankAccount],
            instructions: [
                anchor.web3.SystemProgram.createAccount({
                    fromPubkey: program.provider.wallet.publicKey,
                    newAccountPubkey: crankAccount.publicKey,
                    space: size,
                    lamports: await program.provider.connection.getMinimumBalanceForRentExemption(size),
                    programId: program.programId,
                }),
            ],
        });
        return new CrankAccount({ program, keypair: crankAccount });
    }
    // TODO: Add permission for the crank addition. Could just be permission for feed on queue
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
        const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(this.program, queueAccount, aggregatorAccount);
        let lease = null;
        try {
            lease = await leaseAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested pda account has not been initialized.");
        }
        const [permissionAccount, permissionBump] = await PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, aggregatorAccount.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested pda account has not been initialized.");
        }
        const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(this.program);
        return await this.program.rpc.crankPush({
            stateBump,
            permissionBump,
        }, {
            accounts: {
                crank: this.publicKey,
                aggregator: aggregatorAccount.publicKey,
                oracleQueue: queueAccount.publicKey,
                queueAuthority,
                permission: permissionAccount.publicKey,
                lease: leaseAccount.publicKey,
                escrow: lease.escrow,
                programState: programStateAccount.publicKey,
            },
        });
    }
    /**
     * Pops an aggregator from the crank.
     * @param params
     * @return TransactionSignature
     */
    async pop(params) {
        var _a, _b;
        let crank = await this.loadData();
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: crank.queuePubkey,
        });
        const queueAuthority = (await queueAccount.loadData()).authority;
        const peakAggKeys = await this.peakNext(6);
        let remainingAccounts = peakAggKeys.slice();
        const leaseBumpsMap = new Map();
        const permissionBumpsMap = new Map();
        for (const feedKey of peakAggKeys) {
            const aggregatorAccount = new AggregatorAccount({
                program: this.program,
                publicKey: feedKey,
            });
            const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(this.program, new OracleQueueAccount({
                program: this.program,
                publicKey: crank.queuePubkey,
            }), aggregatorAccount);
            const escrow = (await leaseAccount.loadData()).escrow;
            const [permissionAccount, permissionBump] = await PermissionAccount.fromSeed(this.program, queueAuthority, queueAccount.publicKey, feedKey);
            remainingAccounts.push(leaseAccount.publicKey);
            remainingAccounts.push(escrow);
            remainingAccounts.push(permissionAccount.publicKey);
            leaseBumpsMap.set(feedKey.toBase58(), leaseBump);
            permissionBumpsMap.set(feedKey.toBase58(), permissionBump);
        }
        // TODO: this sort might need fixing to align
        remainingAccounts.sort((a, b) => a.toBuffer().compare(b.toBuffer()));
        const leaseBumps = [];
        const permissionBumps = [];
        // Map bumps to the index of their corresponding feeds.
        for (const key of remainingAccounts) {
            leaseBumps.push((_a = leaseBumpsMap.get(key.toBase58())) !== null && _a !== void 0 ? _a : 0);
            permissionBumps.push((_b = permissionBumpsMap.get(key.toBase58())) !== null && _b !== void 0 ? _b : 0);
        }
        const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(this.program);
        return await this.program.rpc.crankPop({
            stateBump,
            leaseBumps: Buffer.from(leaseBumps),
            permissionBumps: Buffer.from(permissionBumps),
        }, {
            accounts: {
                crank: this.publicKey,
                oracleQueue: crank.queuePubkey,
                queueAuthority,
                programState: programStateAccount.publicKey,
                payoutWallet: params.payoutWallet,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
            },
            remainingAccounts: remainingAccounts.map((pubkey) => {
                return { isSigner: false, isWritable: true, pubkey };
            }),
        });
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
            .sort((a, b) => a.nextTimestamp < b.nextTimestamp)
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
            if (params.publicKey !== params.keypair.publicKey) {
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
        const oracleAccount = anchor.web3.Keypair.generate();
        const size = program.account.oracleAccountData.size;
        const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(program);
        const switchTokenMint = await programStateAccount.getTokenMint();
        const wallet = await switchTokenMint.createAccount(program.provider.wallet.publicKey);
        await program.rpc.oracleInit({
            stateBump,
        }, {
            accounts: {
                oracle: oracleAccount.publicKey,
                queue: params.queueAccount.publicKey,
                wallet,
                programState: programStateAccount.publicKey,
                systemProgram: web3_js_1.SystemProgram.programId,
                payer: program.provider.wallet.publicKey,
            },
            signers: [oracleAccount],
        });
        return new OracleAccount({ program, keypair: oracleAccount });
    }
    /**
     * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
     * @return TransactionSignature.
     */
    async heartbeat() {
        const queueAccount = new OracleQueueAccount({
            program: this.program,
            publicKey: (await this.loadData()).queuePubkey,
        });
        const queue = await queueAccount.loadData();
        let lastPubkey = this.publicKey;
        if (queue.size !== 0) {
            lastPubkey = queue.queue[queue.gcIdx];
        }
        const [permissionAccount, permissionBump] = await PermissionAccount.fromSeed(this.program, queue.authority, queueAccount.publicKey, this.publicKey);
        try {
            await permissionAccount.loadData();
        }
        catch (_) {
            throw new Error("A requested pda account has not been initialized.");
        }
        return await this.program.rpc.oracleHeartbeat({
            permissionBump,
        }, {
            accounts: {
                oracle: this.publicKey,
                gcOracle: lastPubkey,
                oracleQueue: queueAccount.publicKey,
                permission: permissionAccount.publicKey,
            },
            signers: [this.keypair],
        });
    }
}
exports.OracleAccount = OracleAccount;
//# sourceMappingURL=sbv2.js.map