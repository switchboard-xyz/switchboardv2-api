"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
exports.SwitchboardTestContext = void 0;
const anchor = __importStar(require("@project-serum/anchor"));
const spl = __importStar(require("@solana/spl-token"));
const sbv2 = __importStar(require("../sbv2"));
const web3_js_1 = require("@solana/web3.js");
const switchboard_api_1 = require("@switchboard-xyz/switchboard-api");
const big_js_1 = __importDefault(require("big.js"));
const utils_1 = require("./utils");
class SwitchboardTestContext {
    constructor(ctx) {
        this.program = ctx.program;
        this.mint = ctx.mint;
        this.tokenWallet = ctx.tokenWallet;
        this.queue = ctx.queue;
        this.oracle = ctx.oracle;
    }
    // Switchboard currently uses wrapped SOL for mint
    static async createSwitchboardWallet(program, amount = 1000000) {
        const payerKeypair = sbv2.getPayer(program);
        return spl.Token.createWrappedNativeAccount(program.provider.connection, spl.TOKEN_PROGRAM_ID, payerKeypair.publicKey, payerKeypair, amount);
    }
    // public static async depositSwitchboardWallet(
    //   program: anchor.Program,
    //   wallet: PublicKey,
    //   amount: number
    // ) {
    //   const payerKeypair = sbv2.getPayer(program);
    //   const requestTxn = await program.provider.connection.requestAirdrop(
    //     wallet,
    //     amount
    //   );
    //   // TODO: Figure out how to wrap from spl.Token
    // }
    /** Load SwitchboardTestContext from an env file containing $SWITCHBOARD_PROGRAM_ID, $ORACLE_QUEUE, $AGGREGATOR, $ORACLE
     * @param provider anchor Provider containing connection and payer Keypair
     * @param filePath filesystem path to env file
     */
    static async loadFromEnv(provider, filePath) {
        require("dotenv").config({ path: filePath });
        if (!process.env.SWITCHBOARD_PROGRAM_ID) {
            throw new Error(`your env file must have $SWITCHBOARD_PROGRAM_ID set`);
        }
        const SWITCHBOARD_PID = new web3_js_1.PublicKey(process.env.SWITCHBOARD_PROGRAM_ID);
        const switchboardIdl = await anchor.Program.fetchIdl(SWITCHBOARD_PID, provider);
        if (!switchboardIdl) {
            throw new Error(`failed to load Switchboard IDL`);
        }
        const switchboardProgram = new anchor.Program(switchboardIdl, SWITCHBOARD_PID, provider);
        if (!process.env.ORACLE_QUEUE) {
            throw new Error(`your env file must have $ORACLE_QUEUE set`);
        }
        const SWITCHBOARD_QUEUE = new web3_js_1.PublicKey(process.env.ORACLE_QUEUE);
        const queue = new sbv2.OracleQueueAccount({
            program: switchboardProgram,
            publicKey: SWITCHBOARD_QUEUE,
        });
        // TODO: Check oracle is heartbeating when context starts
        if (!process.env.ORACLE) {
            throw new Error(`your env file must have $ORACLE set`);
        }
        const SWITCHBOARD_ORACLE = new web3_js_1.PublicKey(process.env.ORACLE);
        const oracle = new sbv2.OracleAccount({
            program: switchboardProgram,
            publicKey: SWITCHBOARD_ORACLE,
        });
        const [switchboardProgramState] = sbv2.ProgramStateAccount.fromSeed(switchboardProgram);
        const switchboardMint = await switchboardProgramState.getTokenMint();
        const tokenWallet = await SwitchboardTestContext.createSwitchboardWallet(switchboardProgram);
        const context = {
            program: switchboardProgram,
            mint: switchboardMint,
            tokenWallet,
            queue,
            oracle,
        };
        return new SwitchboardTestContext(context);
    }
    /** Create a static data feed that resolves to an expected value */
    async createStaticFeed(value) {
        const queue = await this.queue.loadData();
        const payerKeypair = sbv2.getPayer(this.program);
        // create aggregator
        const aggregatorAccount = await sbv2.AggregatorAccount.create(this.program, {
            batchSize: 1,
            minRequiredJobResults: 1,
            minRequiredOracleResults: 1,
            minUpdateDelaySeconds: 5,
            queueAccount: this.queue,
            authorWallet: this.tokenWallet,
        });
        // create permission account and approve if necessary
        const permissionAccount = await sbv2.PermissionAccount.create(this.program, {
            authority: queue.authority,
            granter: this.queue.publicKey,
            grantee: aggregatorAccount.publicKey,
        });
        if (!queue.unpermissionedFeedsEnabled) {
            if (queue.authority.equals(payerKeypair.publicKey)) {
                await permissionAccount.set({
                    authority: payerKeypair,
                    enable: true,
                    permission: sbv2.SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE,
                });
            }
            throw new Error(`must provide queue authority to permit data feeds to join`);
        }
        // create lease contract
        const leaseAccount = await sbv2.LeaseAccount.create(this.program, {
            aggregatorAccount,
            funder: this.tokenWallet,
            funderAuthority: payerKeypair,
            loadAmount: new anchor.BN(0),
            oracleQueueAccount: this.queue,
        });
        // create and add job account
        const staticJob = await sbv2.JobAccount.create(this.program, {
            name: Buffer.from(`Value ${value}`),
            authority: this.tokenWallet,
            data: Buffer.from(switchboard_api_1.OracleJob.encodeDelimited(switchboard_api_1.OracleJob.create({
                tasks: [
                    switchboard_api_1.OracleJob.Task.create({
                        valueTask: switchboard_api_1.OracleJob.ValueTask.create({
                            value,
                        }),
                    }),
                ],
            })).finish()),
        });
        await aggregatorAccount.addJob(staticJob);
        // open new round and request new result
        await aggregatorAccount.openRound({
            oracleQueueAccount: this.queue,
            payoutWallet: this.tokenWallet,
        });
        return aggregatorAccount;
    }
    /** Update a feed to a single job that resolves to a new expected value
     * @param aggregatorAccount the aggregator to change a job definition for
     * @param value the new expected value
     * @param timeout how long to wait for the oracle to update the aggregator's latestRound result
     */
    async updateStaticFeed(aggregatorAccount, value, timeout = 30) {
        const aggregator = await aggregatorAccount.loadData();
        const expectedValue = new big_js_1.default(value);
        const queue = await this.queue.loadData();
        // remove all existing jobs
        const existingJobs = aggregator.jobPubkeysData
            // eslint-disable-next-line array-callback-return
            .filter((jobKey) => {
            if (!jobKey.equals(utils_1.DEFAULT_PUBKEY)) {
                return jobKey;
            }
        })
            .map((jobKey) => new sbv2.JobAccount({
            program: this.program,
            publicKey: jobKey,
        }));
        await Promise.all(existingJobs.map((job) => aggregatorAccount.removeJob(job)));
        // add new static job
        const staticJob = await sbv2.JobAccount.create(this.program, {
            name: Buffer.from(`Value ${value}`),
            authority: web3_js_1.Keypair.generate().publicKey,
            data: Buffer.from(switchboard_api_1.OracleJob.encodeDelimited(switchboard_api_1.OracleJob.create({
                tasks: [
                    switchboard_api_1.OracleJob.Task.create({
                        valueTask: switchboard_api_1.OracleJob.ValueTask.create({
                            value,
                        }),
                    }),
                ],
            })).finish()),
        });
        await aggregatorAccount.addJob(staticJob);
        // call open round and wait for new value
        const accountsCoder = new anchor.BorshAccountsCoder(this.program.idl);
        let accountWs;
        const awaitUpdatePromise = new Promise((resolve) => {
            accountWs = this.program.provider.connection.onAccountChange(aggregatorAccount.publicKey, async (accountInfo) => {
                const aggregator = accountsCoder.decode("AggregatorAccountData", accountInfo.data);
                const latestResult = await aggregatorAccount.getLatestValue(aggregator);
                if (latestResult.eq(expectedValue)) {
                    resolve(latestResult);
                }
            });
        });
        const updatedValuePromise = (0, utils_1.promiseWithTimeout)(timeout * 1000, awaitUpdatePromise, new Error(`aggregator failed to update in ${timeout} seconds`)).finally(() => {
            if (accountWs) {
                this.program.provider.connection.removeAccountChangeListener(accountWs);
            }
        });
        await aggregatorAccount.openRound({
            oracleQueueAccount: this.queue,
            payoutWallet: this.tokenWallet,
        });
        await updatedValuePromise;
        if (!updatedValuePromise) {
            throw new Error(`failed to update aggregator`);
        }
    }
}
exports.SwitchboardTestContext = SwitchboardTestContext;
//# sourceMappingURL=context.js.map