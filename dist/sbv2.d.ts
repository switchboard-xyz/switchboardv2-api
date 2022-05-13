/// <reference types="node" />
import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import { AccountInfo, AccountMeta, ConfirmOptions, Connection, Keypair, PublicKey, Signer, Transaction, TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import Big from "big.js";
import * as crypto from "crypto";
export * from "./test";
export { OracleJob } from "@switchboard-xyz/switchboard-api";
/**
 * Switchboard Devnet Program ID
 * 2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG
 */
export declare const SBV2_DEVNET_PID: anchor.web3.PublicKey;
/**
 * Switchboard Mainnet Program ID
 * SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f
 */
export declare const SBV2_MAINNET_PID: anchor.web3.PublicKey;
export declare const GOVERNANCE_PID: anchor.web3.PublicKey;
/**
 * Load the Switchboard Program ID for a given cluster
 * @param cluster solana cluster to fetch program ID for
 * @return Switchboard Program ID Public Key
 */
export declare function getSwitchboardPid(cluster: "devnet" | "mainnet-beta"): PublicKey;
/**
 * Load the Switchboard Program for a given cluster
 * @param cluster solana cluster to interact with
 * @param connection optional Connection object to use for rpc request
 * @param payerKeypair optional Keypair to use for onchain txns. If ommited, a dummy keypair will be used and onchain txns will fail
 * @param confirmOptions optional confirmation options for rpc request
 * @return Switchboard Program
 */
export declare function loadSwitchboardProgram(cluster: "devnet" | "mainnet-beta", connection?: anchor.web3.Connection, payerKeypair?: Keypair, confirmOptions?: ConfirmOptions): Promise<anchor.Program>;
/**
 * Switchboard precisioned representation of numbers.
 */
export declare class SwitchboardDecimal {
    readonly mantissa: anchor.BN;
    readonly scale: number;
    constructor(mantissa: anchor.BN, scale: number);
    /**
     * Convert untyped object to a Switchboard decimal, if possible.
     * @param obj raw object to convert from
     * @return SwitchboardDecimal
     */
    static from(obj: any): SwitchboardDecimal;
    /**
     * Convert a Big.js decimal to a Switchboard decimal.
     * @param big a Big.js decimal
     * @return a SwitchboardDecimal
     */
    static fromBig(big: Big): SwitchboardDecimal;
    /**
     * SwitchboardDecimal equality comparator.
     * @param other object to compare to.
     * @return true iff equal
     */
    eq(other: SwitchboardDecimal): boolean;
    /**
     * Convert SwitchboardDecimal to big.js Big type.
     * @return Big representation
     */
    toBig(): Big;
}
/**
 * Input parameters for constructing wrapped representations of Switchboard accounts.
 */
export interface AccountParams {
    /**
     * program referencing the Switchboard program and IDL.
     */
    program: anchor.Program;
    /**
     * Public key of the account being referenced. This will always be populated
     * within the account wrapper.
     */
    publicKey?: PublicKey;
    /**
     * Keypair of the account being referenced. This may not always be populated.
     */
    keypair?: Keypair;
}
/**
 * Input parameters initializing program state.
 */
export interface ProgramInitParams {
    mint?: PublicKey;
    daoMint?: PublicKey;
}
export interface ProgramConfigParams {
    mint?: PublicKey;
    daoMint?: PublicKey;
}
/**
 * Input parameters for transferring from Switchboard token vault.
 */
export interface VaultTransferParams {
    amount: anchor.BN;
}
/**
 * Account type representing Switchboard global program state.
 */
export declare class ProgramStateAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * ProgramStateAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Constructs ProgramStateAccount from the static seed from which it was generated.
     * @return ProgramStateAccount and PDA bump tuple.
     */
    static fromSeed(program: anchor.Program): [ProgramStateAccount, number];
    /**
     * Load and parse ProgramStateAccount state based on the program IDL.
     * @return ProgramStateAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Fetch the Switchboard token mint specified in the program state account.
     * @return Switchboard token mint.
     */
    getTokenMint(): Promise<spl.Token>;
    /**
     * @return account size of the global ProgramStateAccount.
     */
    size(): number;
    static getOrCreate(program: anchor.Program, params: ProgramInitParams): Promise<[ProgramStateAccount, number]>;
    /**
     * Create and initialize the ProgramStateAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated ProgramStateAccount.
     */
    static create(program: anchor.Program, params: ProgramInitParams): Promise<ProgramStateAccount>;
    /**
     * Transfer N tokens from the program vault to a specified account.
     * @param to The recipient of the vault tokens.
     * @param authority The vault authority required to sign the transfer tx.
     * @param params specifies the amount to transfer.
     * @return TransactionSignature
     */
    vaultTransfer(to: PublicKey, authority: Keypair, params: VaultTransferParams): Promise<TransactionSignature>;
}
/**
 * Parameters to initialize an aggregator account.
 */
export interface AggregatorInitParams {
    /**
     *  Name of the aggregator to store on-chain.
     */
    name?: Buffer;
    /**
     *  Metadata of the aggregator to store on-chain.
     */
    metadata?: Buffer;
    /**
     *  Number of oracles to request on aggregator update.
     */
    batchSize: number;
    /**
     *  Minimum number of oracle responses required before a round is validated.
     */
    minRequiredOracleResults: number;
    /**
     *  Minimum number of feed jobs suggested to be successful before an oracle
     *  sends a response.
     */
    minRequiredJobResults: number;
    /**
     *  Minimum number of seconds required between aggregator rounds.
     */
    minUpdateDelaySeconds: number;
    /**
     *  The queue to which this aggregator will be linked
     */
    queueAccount: OracleQueueAccount;
    /**
     *  unix_timestamp for which no feed update will occur before.
     */
    startAfter?: number;
    /**
     *  Change percentage required between a previous round and the current round.
     *  If variance percentage is not met, reject new oracle responses.
     */
    varianceThreshold?: number;
    /**
     *  Number of seconds for which, even if the variance threshold is not passed,
     *  accept new responses from oracles.
     */
    forceReportPeriod?: anchor.BN;
    /**
     *  unix_timestamp after which funds may be withdrawn from the aggregator.
     *  null/undefined/0 means the feed has no expiration.
     */
    expiration?: anchor.BN;
    /**
     *  Optional pre-existing keypair to use for aggregator initialization.
     */
    keypair?: Keypair;
    /**
     *  An optional wallet for receiving kickbacks from job usage in feeds.
     *  Defaults to token vault.
     */
    authorWallet?: PublicKey;
    /**
     *  If included, this keypair will be the aggregator authority rather than
     *  the aggregator keypair.
     */
    authority?: PublicKey;
}
/**
 * Parameters for which oracles must submit for responding to update requests.
 */
export interface AggregatorSaveResultParams {
    /**
     *  Index in the list of oracles in the aggregator assigned to this round update.
     */
    oracleIdx: number;
    /**
     *  Reports that an error occured and the oracle could not send a value.
     */
    error: boolean;
    /**
     *  Value the oracle is responding with for this update.
     */
    value: Big;
    /**
     *  The minimum value this oracle has seen this round for the jobs listed in the
     *  aggregator.
     */
    minResponse: Big;
    /**
     *  The maximum value this oracle has seen this round for the jobs listed in the
     *  aggregator.
     */
    maxResponse: Big;
    /**
     *  List of OracleJobs that were performed to produce this result.
     */
    jobs: Array<OracleJob>;
    /**
     *  Authority of the queue the aggregator is attached to.
     */
    queueAuthority: PublicKey;
    /**
     *  Program token mint.
     */
    tokenMint: PublicKey;
    /**
     *  List of parsed oracles.
     */
    oracles: Array<any>;
}
/**
 * Parameters for creating and setting a history buffer for an aggregator
 */
export interface AggregatorSetHistoryBufferParams {
    authority?: Keypair;
    size: number;
}
/**
 * Parameters required to open an aggregator round
 */
export interface AggregatorOpenRoundParams {
    /**
     *  The oracle queue from which oracles are assigned this update.
     */
    oracleQueueAccount: OracleQueueAccount;
    /**
     *  The token wallet which will receive rewards for calling update on this feed.
     */
    payoutWallet: PublicKey;
}
/**
 * Switchboard wrapper for anchor program errors.
 */
export declare class SwitchboardError {
    /**
     *  The program containing the Switchboard IDL specifying error codes.
     */
    program: anchor.Program;
    /**
     *  Stringified name of the error type.
     */
    name: string;
    /**
     *  Numerical SwitchboardError representation.
     */
    code: number;
    /**
     *  Message describing this error in detail.
     */
    msg?: string;
    /**
     * Converts a numerical error code to a SwitchboardError based on the program
     * IDL.
     * @param program the Switchboard program object containing the program IDL.
     * @param code Error code to convert to a SwitchboardError object.
     * @return SwitchboardError
     */
    static fromCode(program: anchor.Program, code: number): SwitchboardError;
}
/**
 * Row structure of elements in the aggregator history buffer.
 */
export declare class AggregatorHistoryRow {
    /**
     *  Timestamp of the aggregator result.
     */
    timestamp: anchor.BN;
    /**
     *  Aggregator value at timestamp.
     */
    value: Big;
    static from(buf: Buffer): AggregatorHistoryRow;
}
export interface AggregatorSetBatchSizeParams {
    batchSize: number;
    authority?: Keypair;
}
export interface AggregatorSetMinJobsParams {
    minJobResults: number;
    authority?: Keypair;
}
export interface AggregatorSetMinOraclesParams {
    minOracleResults: number;
    authority?: Keypair;
}
export interface AggregatorSetQueueParams {
    queueAccount: OracleQueueAccount;
    authority?: Keypair;
}
export interface AggregatorSetUpdateIntervalParams {
    newInterval: number;
    authority?: Keypair;
}
/**
 * Account type representing an aggregator (data feed).
 */
export declare class AggregatorAccount {
    program: anchor.Program;
    publicKey?: PublicKey;
    keypair?: Keypair;
    /**
     * AggregatorAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    static decode(program: anchor.Program, accountInfo: AccountInfo<Buffer>): any;
    /**
     * Returns the aggregator's ID buffer in a stringified format.
     * @param aggregator A preloaded aggregator object.
     * @return The name of the aggregator.
     */
    static getName(aggregator: any): string;
    /**
     * Load and parse AggregatorAccount state based on the program IDL.
     * @return AggregatorAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    loadHistory(aggregator?: any): Promise<Array<AggregatorHistoryRow>>;
    /**
     * Get the latest confirmed value stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed value
     */
    getLatestValue(aggregator?: any, decimals?: number): Promise<Big | null>;
    /**
     * Get the timestamp latest confirmed round stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed timestamp
     */
    getLatestFeedTimestamp(aggregator?: any): Promise<anchor.BN>;
    /**
     * Speciifies if the aggregator settings recommend reporting a new value
     * @param value The value which we are evaluating
     * @param aggregator The loaded aggegator schema
     * @returns boolean
     */
    static shouldReportValue(value: Big, aggregator: any): Promise<boolean>;
    /**
     * Get the individual oracle results of the latest confirmed round.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest results by oracle pubkey
     */
    getConfirmedRoundResults(aggregator?: any): Promise<Array<{
        oracleAccount: OracleAccount;
        value: Big;
    }>>;
    /**
     * Produces a hash of all the jobs currently in the aggregator
     * @return hash of all the feed jobs.
     */
    produceJobsHash(jobs: Array<OracleJob>): crypto.Hash;
    loadCurrentRoundOracles(aggregator?: any): Promise<Array<any>>;
    loadJobAccounts(aggregator?: any): Promise<Array<any>>;
    /**
     * Load and deserialize all jobs stored in this aggregator
     * @return Array<OracleJob>
     */
    loadJobs(aggregator?: any): Promise<Array<OracleJob>>;
    loadHashes(aggregator?: any): Promise<Array<Buffer>>;
    /**
     * Get the size of an AggregatorAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the AggregatorAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated AggregatorAccount.
     */
    static create(program: anchor.Program, params: AggregatorInitParams): Promise<AggregatorAccount>;
    setBatchSize(params: AggregatorSetBatchSizeParams): Promise<TransactionSignature>;
    setVarianceThreshold(params: {
        authority: Keypair;
        threshold: Big;
    }): Promise<TransactionSignature>;
    setMinJobs(params: AggregatorSetMinJobsParams): Promise<TransactionSignature>;
    setMinOracles(params: AggregatorSetMinOraclesParams): Promise<TransactionSignature>;
    setHistoryBuffer(params: AggregatorSetHistoryBufferParams): Promise<TransactionSignature>;
    setUpdateInterval(params: AggregatorSetUpdateIntervalParams): Promise<TransactionSignature>;
    setQueue(params: AggregatorSetQueueParams): Promise<TransactionSignature>;
    /**
     * RPC to add a new job to an aggregtor to be performed on feed updates.
     * @param job JobAccount specifying another job for this aggregator to fulfill on update
     * @return TransactionSignature
     */
    addJob(job: JobAccount, authority?: Keypair, weight?: number): Promise<TransactionSignature>;
    /**
     * Prevent new jobs from being added to the feed.
     * @param authority The current authroity keypair
     * @return TransactionSignature
     */
    lock(authority?: Keypair): Promise<TransactionSignature>;
    /**
     * Change the aggregator authority.
     * @param currentAuthority The current authroity keypair
     * @param newAuthority The new authority to set.
     * @return TransactionSignature
     */
    setAuthority(newAuthority: PublicKey, currentAuthority?: Keypair): Promise<TransactionSignature>;
    /**
     * RPC to remove a job from an aggregtor.
     * @param job JobAccount to be removed from the aggregator
     * @return TransactionSignature
     */
    removeJob(job: JobAccount, authority?: Keypair): Promise<TransactionSignature>;
    /**
     * Opens a new round for the aggregator and will provide an incentivize reward
     * to the caller
     * @param params
     * @return TransactionSignature
     */
    openRound(params: AggregatorOpenRoundParams): Promise<TransactionSignature>;
    getOracleIndex(oraclePubkey: PublicKey): Promise<number>;
    saveResult(aggregator: any, oracleAccount: OracleAccount, params: AggregatorSaveResultParams): Promise<TransactionSignature>;
    /**
     * RPC for an oracle to save a result to an aggregator round.
     * @param oracleAccount The oracle account submitting a result.
     * @param params
     * @return TransactionSignature
     */
    saveResultTxn(aggregator: any, oracleAccount: OracleAccount, // TODO: move to params.
    params: AggregatorSaveResultParams): Promise<Transaction>;
}
/**
 * Parameters for initializing JobAccount
 */
export interface JobInitParams {
    /**
     *  An optional name to apply to the job account.
     */
    name?: Buffer;
    /**
     *  unix_timestamp of when funds can be withdrawn from this account.
     */
    expiration?: anchor.BN;
    /**
     *  A serialized protocol buffer holding the schema of the job.
     */
    data: Buffer;
    /**
     *  A required variables oracles must fill to complete the job.
     */
    variables?: Array<string>;
    /**
     *  A pre-generated keypair to use.
     */
    keypair?: Keypair;
    authority: PublicKey;
}
/**
 * A Switchboard account representing a job for an oracle to perform, stored as
 * a protocol buffer.
 */
export declare class JobAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * JobAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Load and parse JobAccount data based on the program IDL.
     * @return JobAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Load and parse the protobuf from the raw buffer stored in the JobAccount.
     * @return OracleJob
     */
    loadJob(): Promise<OracleJob>;
    /**
     * Create and initialize the JobAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated JobAccount.
     */
    static create(program: anchor.Program, params: JobInitParams): Promise<JobAccount>;
    static decode(program: anchor.Program, accountInfo: AccountInfo<Buffer>): any;
    static decodeJob(program: anchor.Program, accountInfo: AccountInfo<Buffer>): OracleJob;
}
/**
 * Parameters for initializing PermissionAccount
 */
export interface PermissionInitParams {
    /**
     *  Pubkey of the account granting the permission.
     */
    granter: PublicKey;
    /**
     *  The receiving account of a permission.
     */
    grantee: PublicKey;
    /**
     *  The authority that is allowed to set permissions for this account.
     */
    authority: PublicKey;
}
/**
 * Parameters for setting a permission in a PermissionAccount
 */
export interface PermissionSetParams {
    /**
     *  The permssion to set
     */
    permission: SwitchboardPermission;
    /**
     *  The authority controlling this permission.
     */
    authority: Keypair | PublicKey;
    /**
     *  Specifies whether to enable or disable the permission.
     */
    enable: boolean;
}
export interface PermissionSetVoterWeightParams {
    govProgram: PublicKey;
}
/**
 * An enum representing all known permission types for Switchboard.
 */
export declare enum SwitchboardPermission {
    PERMIT_ORACLE_HEARTBEAT = "permitOracleHeartbeat",
    PERMIT_ORACLE_QUEUE_USAGE = "permitOracleQueueUsage",
    PERMIT_VRF_REQUESTS = "permitVrfRequests"
}
export declare enum SwitchboardPermissionValue {
    PERMIT_ORACLE_HEARTBEAT = 1,
    PERMIT_ORACLE_QUEUE_USAGE = 2,
    PERMIT_VRF_REQUESTS = 4
}
/**
 * A Switchboard account representing a permission or privilege granted by one
 * account signer to another account.
 */
export declare class PermissionAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * PermissionAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Check if a specific permission is enabled on this permission account
     */
    isPermissionEnabled(permission: SwitchboardPermissionValue): Promise<boolean>;
    /**
     * Load and parse PermissionAccount data based on the program IDL.
     * @return PermissionAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Get the size of a PermissionAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the PermissionAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated PermissionAccount.
     */
    static create(program: anchor.Program, params: PermissionInitParams): Promise<PermissionAccount>;
    /**
     * Loads a PermissionAccount from the expected PDA seed format.
     * @param authority The authority pubkey to be incorporated into the account seed.
     * @param granter The granter pubkey to be incorporated into the account seed.
     * @param grantee The grantee pubkey to be incorporated into the account seed.
     * @return PermissionAccount and PDA bump.
     */
    static fromSeed(program: anchor.Program, authority: PublicKey, granter: PublicKey, grantee: PublicKey): [PermissionAccount, number];
    /**
     * Sets the permission in the PermissionAccount
     * @param params.
     * @return TransactionSignature.
     */
    set(params: PermissionSetParams): Promise<TransactionSignature>;
    /**
     * Sets the permission in the PermissionAccount
     * @param params.
     * @return TransactionSignature.
     */
    setTx(params: PermissionSetParams): Promise<Transaction>;
    setVoterWeight(params: PermissionSetVoterWeightParams): Promise<TransactionSignature>;
    setVoterWeightTx(params: PermissionSetVoterWeightParams): Promise<Transaction>;
}
/**
 * Parameters for initializing OracleQueueAccount
 */
export interface OracleQueueInitParams {
    /**
     *  A name to assign to this OracleQueue
     */
    name?: Buffer;
    /**
     *  Buffer for queue metadata
     */
    metadata?: Buffer;
    /**
     *  Rewards to provide oracles and round openers on this queue.
     */
    reward: anchor.BN;
    /**
     *  The minimum amount of stake oracles must present to remain on the queue.
     */
    minStake: anchor.BN;
    /**
     *  After a feed lease is funded or re-funded, it must consecutively succeed
     *  N amount of times or its authorization to use the queue is auto-revoked.
     */
    feedProbationPeriod?: number;
    /**
     *  The account to delegate authority to for creating permissions targeted
     *  at the queue.
     */
    authority: PublicKey;
    /**
     *  Time period we should remove an oracle after if no response.
     */
    oracleTimeout?: anchor.BN;
    /**
     *  Whether slashing is enabled on this queue.
     */
    slashingEnabled?: boolean;
    /**
     *  The tolerated variance amount oracle results can have from the
     *  accepted round result before being slashed.
     *  slashBound = varianceToleranceMultiplier * stdDeviation
     *  Default: 2
     */
    varianceToleranceMultiplier?: number;
    /**
     *  Consecutive failure limit for a feed before feed permission is revoked.
     */
    consecutiveFeedFailureLimit?: anchor.BN;
    /**
     *  TODO: implement
     *  Consecutive failure limit for an oracle before oracle permission is revoked.
     */
    consecutiveOracleFailureLimit?: anchor.BN;
    /**
     * the minimum update delay time for Aggregators
     */
    minimumDelaySeconds?: number;
    /**
     * Optionally set the size of the queue.
     */
    queueSize?: number;
    /**
     * Eanbling this setting means data feeds do not need explicit permission
     * to join the queue.
     */
    unpermissionedFeeds?: boolean;
    /**
     * Eanbling this setting means data feeds do not need explicit permission
     * to request VRF proofs and verifications from this queue.
     */
    unpermissionedVrf?: boolean;
    mint: PublicKey;
}
export interface OracleQueueSetRewardsParams {
    rewards: anchor.BN;
    authority?: Keypair;
}
export interface OracleQueueSetVrfSettingsParams {
    unpermissionedVrf: boolean;
    authority?: Keypair;
}
/**
 * A Switchboard account representing a queue for distributing oracles to
 * permitted data feeds.
 */
export declare class OracleQueueAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * OracleQueueAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    loadMint(): Promise<spl.Token>;
    /**
     * Load and parse OracleQueueAccount data based on the program IDL.
     * @return OracleQueueAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Get the size of an OracleQueueAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the OracleQueueAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated OracleQueueAccount.
     */
    static create(program: anchor.Program, params: OracleQueueInitParams): Promise<OracleQueueAccount>;
    setRewards(params: OracleQueueSetRewardsParams): Promise<TransactionSignature>;
    setVrfSettings(params: OracleQueueSetVrfSettingsParams): Promise<TransactionSignature>;
}
/**
 * Parameters for initializing a LeaseAccount
 */
export interface LeaseInitParams {
    /**
     *  Token amount to load into the lease escrow
     */
    loadAmount: anchor.BN;
    /**
     *  The funding wallet of the lease.
     */
    funder: PublicKey;
    /**
     *  The authority of the funding wallet
     */
    funderAuthority: Keypair;
    /**
     *  The target to which this lease is applied.
     */
    oracleQueueAccount: OracleQueueAccount;
    /**
     *  The feed which the lease grants permission.
     */
    aggregatorAccount: AggregatorAccount;
    /**
     *  This authority will be permitted to withdraw funds from this lease.
     */
    withdrawAuthority?: PublicKey;
}
/**
 * Parameters for extending a LeaseAccount
 */
export interface LeaseExtendParams {
    /**
     *  Token amount to load into the lease escrow
     */
    loadAmount: anchor.BN;
    /**
     *  The funding wallet of the lease.
     */
    funder: PublicKey;
    /**
     *  The authority of the funding wallet
     */
    funderAuthority: Keypair;
}
/**
 * Parameters for withdrawing from a LeaseAccount
 */
export interface LeaseWithdrawParams {
    /**
     *  Token amount to withdraw from the lease escrow
     */
    amount: anchor.BN;
    /**
     *  The wallet to withdraw to.
     */
    withdrawWallet: PublicKey;
    /**
     *  The withdraw authority of the lease
     */
    withdrawAuthority: Keypair;
}
/**
 * A Switchboard account representing a lease for managing funds for oracle payouts
 * for fulfilling feed updates.
 */
export declare class LeaseAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * LeaseAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Loads a LeaseAccount from the expected PDA seed format.
     * @param leaser The leaser pubkey to be incorporated into the account seed.
     * @param target The target pubkey to be incorporated into the account seed.
     * @return LeaseAccount and PDA bump.
     */
    static fromSeed(program: anchor.Program, queueAccount: OracleQueueAccount, aggregatorAccount: AggregatorAccount): [LeaseAccount, number];
    /**
     * Load and parse LeaseAccount data based on the program IDL.
     * @return LeaseAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Get the size of a LeaseAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the LeaseAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated LeaseAccount.
     */
    static create(program: anchor.Program, params: LeaseInitParams): Promise<LeaseAccount>;
    getBalance(): Promise<number>;
    /**
     * Estimate the time remaining on a given lease
     * @params void
     * @returns number milliseconds left in lease (estimate)
     */
    estimatedLeaseTimeRemaining(): Promise<number>;
    /**
     * Adds fund to a LeaseAccount. Note that funds can always be withdrawn by
     * the withdraw authority if one was set on lease initialization.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     */
    extend(params: LeaseExtendParams): Promise<TransactionSignature>;
    /**
     * Withdraw funds from a LeaseAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     */
    withdraw(params: LeaseWithdrawParams): Promise<TransactionSignature>;
}
/**
 * Parameters for initializing a CrankAccount
 */
export interface CrankInitParams {
    /**
     *  Buffer specifying crank name
     */
    name?: Buffer;
    /**
     *  Buffer specifying crank metadata
     */
    metadata?: Buffer;
    /**
     *  OracleQueueAccount for which this crank is associated
     */
    queueAccount: OracleQueueAccount;
    /**
     * Optional max number of rows
     */
    maxRows?: number;
}
/**
 * Parameters for popping an element from a CrankAccount.
 */
export interface CrankPopParams {
    /**
     * Specifies the wallet to reward for turning the crank.
     */
    payoutWallet: PublicKey;
    /**
     * The pubkey of the linked oracle queue.
     */
    queuePubkey: PublicKey;
    /**
     * The pubkey of the linked oracle queue authority.
     */
    queueAuthority: PublicKey;
    /**
     * Array of pubkeys to attempt to pop. If discluded, this will be loaded
     * from the crank upon calling.
     */
    readyPubkeys?: Array<PublicKey>;
    /**
     * Nonce to allow consecutive crank pops with the same blockhash.
     */
    nonce?: number;
    crank: any;
    queue: any;
    tokenMint: PublicKey;
    failOpenOnMismatch?: boolean;
}
/**
 * Parameters for pushing an element into a CrankAccount.
 */
export interface CrankPushParams {
    /**
     * Specifies the aggregator to push onto the crank.
     */
    aggregatorAccount: AggregatorAccount;
}
/**
 * Row structure of elements in the crank.
 */
export declare class CrankRow {
    /**
     *  Aggregator account pubkey
     */
    pubkey: PublicKey;
    /**
     *  Next aggregator update timestamp to order the crank by
     */
    nextTimestamp: anchor.BN;
    static from(buf: Buffer): CrankRow;
}
/**
 * A Switchboard account representing a crank of aggregators ordered by next update time.
 */
export declare class CrankAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * CrankAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Load and parse CrankAccount data based on the program IDL.
     * @return CrankAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Get the size of a CrankAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the CrankAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated CrankAccount.
     */
    static create(program: anchor.Program, params: CrankInitParams): Promise<CrankAccount>;
    /**
     * Pushes a new aggregator onto the crank.
     * @param aggregator The Aggregator account to push on the crank.
     * @return TransactionSignature
     */
    push(params: CrankPushParams): Promise<TransactionSignature>;
    /**
     * Pops an aggregator from the crank.
     * @param params
     * @return TransactionSignature
     */
    popTxn(params: CrankPopParams): Promise<Transaction>;
    /**
     * Pops an aggregator from the crank.
     * @param params
     * @return TransactionSignature
     */
    pop(params: CrankPopParams): Promise<TransactionSignature>;
    /**
     * Get an array of the next aggregator pubkeys to be popped from the crank, limited by n
     * @param n The limit of pubkeys to return.
     * @return Pubkey list of Aggregators and next timestamp to be popped, ordered by timestamp.
     */
    peakNextWithTime(n: number): Promise<Array<CrankRow>>;
    /**
     * Get an array of the next readily updateable aggregator pubkeys to be popped
     * from the crank, limited by n
     * @param n The limit of pubkeys to return.
     * @return Pubkey list of Aggregator pubkeys.
     */
    peakNextReady(n?: number): Promise<Array<PublicKey>>;
    /**
     * Get an array of the next aggregator pubkeys to be popped from the crank, limited by n
     * @param n The limit of pubkeys to return.
     * @return Pubkey list of Aggregators next up to be popped.
     */
    peakNext(n: number): Promise<Array<PublicKey>>;
}
/**
 * Parameters for an OracleInit request.
 */
export interface OracleInitParams {
    /**
     *  Buffer specifying oracle name
     */
    name?: Buffer;
    /**
     *  Buffer specifying oracle metadata
     */
    metadata?: Buffer;
    /**
     * If included, this keypair will be the oracle authority.
     */
    oracleAuthority?: Keypair;
    /**
     * Specifies the oracle queue to associate with this OracleAccount.
     */
    queueAccount: OracleQueueAccount;
}
/**
 * Parameters for an OracleWithdraw request.
 */
export interface OracleWithdrawParams {
    /**
     *  Amount to withdraw
     */
    amount: anchor.BN;
    /**
     * Token Account to withdraw to
     */
    withdrawAccount: PublicKey;
    /**
     * Oracle authority keypair.
     */
    oracleAuthority: Keypair;
}
/**
 * A Switchboard account representing an oracle account and its associated queue
 * and escrow account.
 */
export declare class OracleAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * OracleAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Load and parse OracleAccount data based on the program IDL.
     * @return OracleAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Get the size of an OracleAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the OracleAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated OracleAccount.
     */
    static create(program: anchor.Program, params: OracleInitParams): Promise<OracleAccount>;
    static decode(program: anchor.Program, accountInfo: AccountInfo<Buffer>): any;
    /**
     * Constructs OracleAccount from the static seed from which it was generated.
     * @return OracleAccount and PDA bump tuple.
     */
    static fromSeed(program: anchor.Program, queueAccount: OracleQueueAccount, wallet: PublicKey): [OracleAccount, number];
    /**
     * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
     * @return TransactionSignature.
     */
    heartbeat(authority: Keypair): Promise<TransactionSignature>;
    /**
    /**
     * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
     * @return TransactionSignature.
     */
    heartbeatTx(): Promise<Transaction>;
    /**
     * Withdraw stake and/or rewards from an OracleAccount.
     */
    withdraw(params: OracleWithdrawParams): Promise<TransactionSignature>;
    getBalance(): Promise<number>;
}
export interface Callback {
    programId: PublicKey;
    accounts: Array<AccountMeta>;
    ixData: Buffer;
}
/**
 * Parameters for a VrfInit request.
 */
export interface VrfInitParams {
    /**
     *  Vrf account authority to configure the account
     */
    authority: PublicKey;
    queue: OracleQueueAccount;
    callback: Callback;
    /**
     *  Keypair to use for the vrf account.
     */
    keypair: Keypair;
}
/**
 * Parameters for a VrfSetCallback request.
 */
export interface VrfSetCallbackParams {
    authority: Keypair;
    cpiProgramId: PublicKey;
    accountList: Array<AccountMeta>;
    instruction: Buffer;
}
export interface VrfProveAndVerifyParams {
    proof: Buffer;
    oracleAccount: OracleAccount;
    oracleAuthority: Keypair;
    skipPreflight: boolean;
}
export interface VrfRequestRandomnessParams {
    authority: Keypair;
    payer: PublicKey;
    payerAuthority: Keypair;
}
export interface VrfProveParams {
    proof: Buffer;
    oracleAccount: OracleAccount;
    oracleAuthority: Keypair;
}
/**
 * A Switchboard VRF account.
 */
export declare class VrfAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * CrankAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Load and parse VrfAccount data based on the program IDL.
     * @return VrfAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    /**
     * Get the size of a VrfAccount on chain.
     * @return size.
     */
    size(): number;
    /**
     * Create and initialize the VrfAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated VrfAccount.
     */
    static create(program: anchor.Program, params: VrfInitParams): Promise<VrfAccount>;
    /**
     * Set the callback CPI when vrf verification is successful.
     */
    /**
     * Trigger new randomness production on the vrf account
     */
    requestRandomness(params: VrfRequestRandomnessParams): Promise<void>;
    prove(params: VrfProveParams): Promise<TransactionSignature>;
    verify(oracle: OracleAccount, tryCount?: number): Promise<Array<TransactionSignature>>;
    /**
     * Attempt the maximum amount of turns remaining on the vrf verify crank.
     * This will automatically call the vrf callback (if set) when completed.
     */
    proveAndVerify(params: VrfProveAndVerifyParams, tryCount?: number): Promise<Array<TransactionSignature>>;
}
export declare class BufferRelayerAccount {
    program: anchor.Program;
    publicKey: PublicKey;
    keypair?: Keypair;
    /**
     * CrankAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
    /**
     * Load and parse BufferRelayerAccount data based on the program IDL.
     * @return BufferRelayerAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    loadData(): Promise<any>;
    size(): number;
    static create(program: anchor.Program, params: {
        name: Buffer;
        minUpdateDelaySeconds: number;
        queueAccount: OracleQueueAccount;
        authority: PublicKey;
        jobAccount: JobAccount;
    }): Promise<BufferRelayerAccount>;
    openRound(): Promise<TransactionSignature>;
    saveResult(params: {
        oracleAuthority: Keypair;
        result: Buffer;
        success: boolean;
    }): Promise<TransactionSignature>;
}
export declare function sendAll(provider: anchor.Provider, reqs: Array<any>, signers: Array<Keypair>, skipPreflight: boolean): Promise<Array<TransactionSignature>>;
/**
 * Pack instructions into transactions as tightly as possible
 * @param instructions Instructions or Grouping of Instructions to pack down into transactions.
 * Arrays of instructions will be grouped into the same tx.
 * NOTE: this will break if grouping is too large for a single tx
 * @param feePayer Optional feepayer
 * @param recentBlockhash Optional blockhash
 * @returns Transaction[]
 */
export declare function packInstructions(instructions: (TransactionInstruction | TransactionInstruction[])[], feePayer?: PublicKey, recentBlockhash?: string): Transaction[];
/**
 * Repack Transactions and sign them
 * @param connection Web3.js Connection
 * @param transactions Transactions to repack
 * @param signers Signers for each transaction
 */
export declare function packTransactions(connection: anchor.web3.Connection, transactions: Transaction[], signers: Keypair[], feePayer: PublicKey): Promise<Transaction[]>;
/**
 * Sign transactions with correct signers
 * @param transactions array of transactions to sign
 * @param signers array of keypairs to sign the array of transactions with
 * @returns transactions signed
 */
export declare function signTransactions(transactions: Transaction[], signers: Keypair[]): Transaction[];
export declare function createMint(connection: Connection, payer: Signer, mintAuthority: PublicKey, freezeAuthority: PublicKey | null, decimals: number, programId: PublicKey, mintAccount: Keypair): Promise<spl.Token>;
export declare function programWallet(program: anchor.Program): Keypair;
