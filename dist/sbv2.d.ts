/// <reference types="node" />
import { PublicKey, Keypair, TransactionSignature } from "@solana/web3.js";
import * as anchor from "@project-serum/anchor";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import * as crypto from "crypto";
import * as spl from "@solana/spl-token";
import Big from "big.js";
/**
 * Switchboard precisioned representation of numbers.
 * @param connection Solana network connection object.
 * @param address The address of the bundle auth account to parse.
 * @return BundleAuth
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
    static fromSeed(program: anchor.Program): Promise<[ProgramStateAccount, number]>;
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
     *  ID of the aggregator to store on-chain.
     */
    id: Buffer;
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
    value: number;
    /**
     *  The minimum value this oracle has seen this round for the jobs listed in the
     *  aggregator.
     */
    minResponse: number;
    /**
     *  The maximum value this oracle has seen this round for the jobs listed in the
     *  aggregator.
     */
    maxResponse: number;
}
/**
 * Parameters required to open an aggregator round
 */
export interface AggregatorOpenRoundParams {
    /**
     *  The account validating that this aggregator has permission to use the given
     *  oracle queue.
     */
    permissionAccount: PermissionAccount;
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
     *  Numerical SwitchboardError reporesentation.
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
    /**
     * Get the latest confirmed value stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed value
     */
    getLatestValue(aggregator?: any): Promise<number>;
    /**
     * Get the timestamp latest confirmed round stored in the aggregator account.
     * @param aggregator Optional parameter representing the already loaded
     * aggregator info.
     * @return latest feed timestamp
     */
    getLatestFeedTimestamp(aggregator?: any): Promise<number>;
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
    produceJobsHash(): Promise<crypto.Hash>;
    /**
     * Load and deserialize all jobs stored in this aggregator
     * @return Array<OracleJob>
     */
    loadJobs(aggregator?: any): Promise<Array<OracleJob>>;
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
    /**
     * RPC to add a new job to an aggregtor to be performed on feed updates.
     * @param job JobAccount specifying another job for this aggregator to fulfill on update
     * @return TransactionSignature
     */
    addJob(job: JobAccount): Promise<TransactionSignature>;
    /**
     * RPC to remove a job from an aggregtor.
     * @param job JobAccount to be removed from the aggregator
     * @return TransactionSignature
     */
    removeJob(job: JobAccount): Promise<TransactionSignature>;
    /**
     * Opens a new round for the aggregator and will provide an incentivize reward
     * to the caller
     * @param params
     * @return TransactionSignature
     */
    openRound(params: AggregatorOpenRoundParams): Promise<TransactionSignature>;
    /**
     * RPC for an oracle to save a result to an aggregator round.
     * @param oracleAccount The oracle account submitting a result.
     * @param params
     * @return TransactionSignature
     */
    saveResult(oracleAccount: OracleAccount, // TODO: move to params.
    params: AggregatorSaveResultParams): Promise<TransactionSignature>;
}
/**
 * Parameters for initializing JobAccount
 */
export interface JobInitParams {
    /**
     *  An optional ID to apply to the job account.
     */
    id?: Buffer;
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
     * Load and parse JobAccount data based on the program IDL from a buffer.
     * @return JobAccount data parsed in accordance with the
     * Switchboard IDL.
     */
    static decode(program: anchor.Program, buf: Buffer): any;
    /**
     * Create and initialize the JobAccount.
     * @param program Switchboard program representation holding connection and IDL.
     * @param params.
     * @return newly generated JobAccount.
     */
    static create(program: anchor.Program, params: JobInitParams): Promise<JobAccount>;
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
    authority: Keypair;
    /**
     *  Specifies whether to enable or disable the permission.
     */
    enable: boolean;
}
/**
 * An enum representing all known permission types for Switchboard.
 */
export declare enum SwitchboardPermission {
    PERMIT_ORACLE_HEARTBEAT = "permitOracleHeartbeat",
    PERMIT_ORACLE_QUEUE_USAGE = "permitOracleQueueUsage"
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
     * AggregatorAccount constructor
     * @param params initialization params.
     */
    constructor(params: AccountParams);
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
    static fromSeed(program: anchor.Program, authority: PublicKey, granter: PublicKey, grantee: PublicKey): Promise<[PermissionAccount, number]>;
    /**
     * Sets the permission in the PermissionAccount
     * @param params.
     * @return TransactionSignature.
     */
    set(params: PermissionSetParams): Promise<TransactionSignature>;
}
/**
 * Parameters for initializing OracleQueueAccount
 */
export interface OracleQueueInitParams {
    /**
     *  A name to assign to this OracleQueue
     */
    id: Buffer;
    /**
     *  Buffer for queue metadata
     */
    metadata: Buffer;
    /**
     *  Slashing mechanisms for oracles on this queue.
     */
    slashingCurve: Buffer;
    /**
     *  Rewards to provide oracles and round openers on this queue.
     */
    reward: anchor.BN;
    /**
     *  The minimum amount of stake oracles must present to remain on the queue.
     */
    minStake: anchor.BN;
    /**
     *  The account to delegate authority to for creating permissions targeted
     *  at the queue.
     */
    authority: PublicKey;
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
    static fromSeed(program: anchor.Program, queueAccount: OracleQueueAccount, aggregatorAccount: AggregatorAccount): Promise<[LeaseAccount, number]>;
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
}
/**
 * Parameters for initializing a CrankAccount
 */
export interface CrankInitParams {
    /**
     *  Buffer specifying crank id
     */
    id: Buffer;
    /**
     *  Buffer specifying crank metadata
     */
    metadata: Buffer;
    /**
     *  OracleQueueAccount for which this crank is associated
     */
    queueAccount: OracleQueueAccount;
}
/**
 * Parameters for popping an element from a CrankAccount.
 */
export interface CrankPopParams {
    /**
     * Specifies the wallet to reward for turning the crank.
     */
    payoutWallet: PublicKey;
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
    pop(params: CrankPopParams): Promise<TransactionSignature>;
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
     * Specifies the oracle queue to associate with this OracleAccount.
     */
    queueAccount: OracleQueueAccount;
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
    /**
     * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
     * @return TransactionSignature.
     */
    heartbeat(): Promise<TransactionSignature>;
}
