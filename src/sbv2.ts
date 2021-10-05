import {
  Cluster,
  clusterApiUrl,
  Connection,
  PublicKey,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
  SystemProgram,
} from "@solana/web3.js";
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
export class SwitchboardDecimal {
  public constructor(
    public readonly mantissa: anchor.BN,
    public readonly scale: number
  ) {}

  /**
   * Convert untyped object to a Switchboard decimal, if possible.
   * @param obj raw object to convert from
   * @return SwitchboardDecimal
   */
  public static from(obj: any): SwitchboardDecimal {
    return new SwitchboardDecimal(new anchor.BN(obj.mantissa), obj.scale);
  }

  /**
   * Convert a Big.js decimal to a Switchboard decimal.
   * @param big a Big.js decimal
   * @return a SwitchboardDecimal
   */
  public static fromBig(big: Big): SwitchboardDecimal {
    let c: anchor.BN = big.c
      .map((n) => new anchor.BN(n, 10))
      .reduce((res: anchor.BN, n) => {
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
  public eq(other: SwitchboardDecimal): boolean {
    return this.mantissa.eq(other.mantissa) && this.scale === other.scale;
  }

  /**
   * Convert SwitchboardDecimal to big.js Big type.
   * @return Big representation
   */
  public toBig(): Big {
    const scale = new Big(`1e-${this.scale}`);
    return new Big(this.mantissa.toString()).times(scale);
  }
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
export interface ProgramInitParams {}

/**
 * Input parameters for transferring from Switchboard token vault.
 */
export interface VaultTransferParams {
  amount: anchor.BN;
}

/**
 * Account type representing Switchboard global program state.
 */
export class ProgramStateAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * ProgramStateAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Constructs ProgramStateAccount from the static seed from which it was generated.
   * @return ProgramStateAccount and PDA bump tuple.
   */
  static async fromSeed(
    program: anchor.Program
  ): Promise<[ProgramStateAccount, number]> {
    const [statePubkey, stateBump] =
      await anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("STATE")],
        program.programId
      );
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
  async loadData(): Promise<any> {
    const state: any = await this.program.account.sbState.fetch(this.publicKey);
    state.ebuf = undefined;
    return state;
  }

  /**
   * Fetch the Switchboard token mint specified in the program state account.
   * @return Switchboard token mint.
   */
  async getTokenMint(): Promise<spl.Token> {
    const payerKeypair = Keypair.fromSecretKey(
      (this.program.provider.wallet as any).payer.secretKey
    );
    const state = await this.loadData();
    const switchTokenMint = new spl.Token(
      this.program.provider.connection,
      state.tokenMint,
      spl.TOKEN_PROGRAM_ID,
      payerKeypair
    );
    return switchTokenMint;
  }

  /**
   * @return account size of the global ProgramStateAccount.
   */
  size(): number {
    return this.program.account.sbState.size;
  }

  /**
   * Create and initialize the ProgramStateAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated ProgramStateAccount.
   */
  static async create(
    program: anchor.Program,
    params: ProgramInitParams
  ): Promise<ProgramStateAccount> {
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    // TODO: save bump
    const [stateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      program
    );
    // TODO: need to save this to change mint and lock minting
    const mintAuthority = anchor.web3.Keypair.generate();
    const decimals = 9;
    const mint = await spl.Token.createMint(
      program.provider.connection,
      payerKeypair,
      mintAuthority.publicKey,
      null,
      decimals,
      spl.TOKEN_PROGRAM_ID
    );
    const tokenVault = await mint.createAccount(
      program.provider.wallet.publicKey
    );
    await mint.mintTo(
      tokenVault,
      mintAuthority.publicKey,
      [mintAuthority],
      100_000_000
    );
    await program.rpc.programInit(
      {
        stateBump,
        decimals: new anchor.BN(decimals),
      },
      {
        accounts: {
          state: stateAccount.publicKey,
          mintAuthority: mintAuthority.publicKey,
          tokenMint: mint.publicKey,
          vault: tokenVault,
          payer: program.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
      }
    );
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
  async vaultTransfer(
    to: PublicKey,
    authority: Keypair,
    params: VaultTransferParams
  ): Promise<TransactionSignature> {
    const [statePubkey, stateBump] =
      await anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("STATE")],
        this.program.programId
      );
    const vault = (await this.loadData()).tokenVault;
    return await this.program.rpc.vaultTransfer(
      {
        stateBump,
        amount: params.amount,
      },
      {
        accounts: {
          state: statePubkey,
          to,
          vault,
          authority: this.program.provider.wallet.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
      }
    );
  }
}

/**
 * Parameters to initialize an aggregator account.
 */
export interface AggregatorInitParams {
  /**
   *  ID of the aggregator to store on-chain.
   */
  id?: Buffer;
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
export class SwitchboardError {
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
  static fromCode(program: anchor.Program, code: number): SwitchboardError {
    for (const e of program.idl.errors ?? []) {
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

/**
 * Account type representing an aggregator (data feed).
 */
export class AggregatorAccount {
  program: anchor.Program;
  publicKey?: PublicKey;
  keypair?: Keypair;

  /**
   * AggregatorAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Returns the aggregator's ID buffer in a stringified format.
   * @param aggregator A preloaded aggregator object.
   * @return The name of the aggregator.
   */
  static getName(aggregator: any): string {
    return Buffer.from(aggregator.id).toString("utf8");
  }

  /**
   * Load and parse AggregatorAccount state based on the program IDL.
   * @return AggregatorAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const aggregator: any =
      await this.program.account.aggregatorAccountData.fetch(this.publicKey);
    aggregator.ebuf = undefined;
    return aggregator;
  }

  /**
   * Get the latest confirmed value stored in the aggregator account.
   * @param aggregator Optional parameter representing the already loaded
   * aggregator info.
   * @return latest feed value
   */
  async getLatestValue(aggregator?: any): Promise<Big> {
    aggregator = aggregator ?? (await this.loadData());
    if ((aggregator.latestConfirmedRound?.numSuccess ?? 0) === 0) {
      throw new Error("Aggregator currently holds no value.");
    }
    const mantissa = new Big(
      aggregator.latestConfirmedRound.result.mantissa.toString()
    );
    const scale = aggregator.latestConfirmedRound.result.scale;
    return mantissa.div(new Big(10).pow(scale));
  }

  /**
   * Get the timestamp latest confirmed round stored in the aggregator account.
   * @param aggregator Optional parameter representing the already loaded
   * aggregator info.
   * @return latest feed timestamp
   */
  async getLatestFeedTimestamp(aggregator?: any): Promise<anchor.BN> {
    aggregator = aggregator ?? (await this.loadData());
    if ((aggregator.latestConfirmedRound?.numSuccess ?? 0) === 0) {
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
  async getConfirmedRoundResults(
    aggregator?: any
  ): Promise<Array<{ oracleAccount: OracleAccount; value: Big }>> {
    aggregator = aggregator ?? (await this.loadData());
    if ((aggregator.latestConfirmedRound?.numSuccess ?? 0) === 0) {
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
          value: SwitchboardDecimal.from(
            aggregator.latestConfirmedRound.mediansData[i]
          ).toBig(),
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
  async produceJobsHash(): Promise<crypto.Hash> {
    // Remember, dont trust the hash listed. Hash exactly the job you will be performing.
    const jobs = await this.loadJobs();

    const hash = crypto.createHash("sha256");
    for (const job of jobs) {
      hash.update(OracleJob.encodeDelimited(job).finish());
    }
    return hash;
  }

  /**
   * Load and deserialize all jobs stored in this aggregator
   * @return Array<OracleJob>
   */
  async loadJobs(aggregator?: any): Promise<Array<OracleJob>> {
    const coder = new anchor.AccountsCoder(this.program.idl);

    aggregator = aggregator ?? (await this.loadData());

    const jobAccountDatas = await anchor.utils.rpc.getMultipleAccounts(
      this.program.provider.connection,
      aggregator.jobPubkeysData.slice(0, aggregator.jobPubkeysSize)
    );
    if (jobAccountDatas === null) {
      throw new Error("Failed to load feed jobs.");
    }
    const jobs = jobAccountDatas.map((item) => {
      let decoded = coder.decode("JobAccountData", item.account.data);
      return OracleJob.decodeDelimited(decoded.data);
    });
    return jobs;
  }

  /**
   * Get the size of an AggregatorAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.aggregatorAccountData.size;
  }

  /**
   * Create and initialize the AggregatorAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated AggregatorAccount.
   */
  static async create(
    program: anchor.Program,
    params: AggregatorInitParams
  ): Promise<AggregatorAccount> {
    const aggregatorAccount = params.keypair ?? anchor.web3.Keypair.generate();
    const size = program.account.aggregatorAccountData.size;
    await program.rpc.aggregatorInit(
      {
        id: (params.id ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 128),
        batchSize: params.batchSize,
        minOracleResults: params.minRequiredOracleResults,
        minJobResults: params.minRequiredJobResults,
        minUpdateDelaySeconds: params.minUpdateDelaySeconds,
        varianceThreshold: (params.varianceThreshold ?? 0).toString(),
        forceReportPeriod: params.forceReportPeriod ?? new anchor.BN(0),
        expiration: params.expiration ?? new anchor.BN(0),
      },
      {
        accounts: {
          aggregator: aggregatorAccount.publicKey,
        },
        signers: [aggregatorAccount],
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: aggregatorAccount.publicKey,
            space: size,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                size
              ),
            programId: program.programId,
          }),
        ],
      }
    );
    return new AggregatorAccount({ program, keypair: aggregatorAccount });
  }

  /**
   * RPC to add a new job to an aggregtor to be performed on feed updates.
   * @param job JobAccount specifying another job for this aggregator to fulfill on update
   * @return TransactionSignature
   */
  async addJob(job: JobAccount): Promise<TransactionSignature> {
    return await this.program.rpc.aggregatorAddJob(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          job: job.publicKey,
        },
        signers: [this.keypair],
      }
    );
  }

  /**
   * RPC to remove a job from an aggregtor.
   * @param job JobAccount to be removed from the aggregator
   * @return TransactionSignature
   */
  async removeJob(job: JobAccount): Promise<TransactionSignature> {
    return await this.program.rpc.aggregatorRemoveJob(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          job: job.publicKey,
        },
        signers: [this.keypair],
      }
    );
  }

  /**
   * Opens a new round for the aggregator and will provide an incentivize reward
   * to the caller
   * @param params
   * @return TransactionSignature
   */
  async openRound(
    params: AggregatorOpenRoundParams
  ): Promise<TransactionSignature> {
    const [stateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      this.program
    );

    const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(
      this.program,
      params.oracleQueueAccount,
      this
    );
    try {
      await leaseAccount.loadData();
    } catch (_) {
      throw new Error("A requested pda account has not been initialized.");
    }

    const escrowPubkey = (await leaseAccount.loadData()).escrow;
    const queue = await params.oracleQueueAccount.loadData();
    const queueAuthority = queue.authority;

    const [permissionAccount, permissionBump] =
      await PermissionAccount.fromSeed(
        this.program,
        queueAuthority,
        params.oracleQueueAccount.publicKey,
        this.publicKey
      );
    try {
      await permissionAccount.loadData();
    } catch (_) {
      throw new Error("A requested pda account has not been initialized.");
    }

    return await this.program.rpc.aggregatorOpenRound(
      {
        stateBump,
        leaseBump,
        permissionBump,
      },
      {
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
      }
    );
  }

  /**
   * RPC for an oracle to save a result to an aggregator round.
   * @param oracleAccount The oracle account submitting a result.
   * @param params
   * @return TransactionSignature
   */
  async saveResult(
    oracleAccount: OracleAccount, // TODO: move to params.
    params: AggregatorSaveResultParams
  ): Promise<TransactionSignature> {
    const aggregator = await this.loadData();
    const remainingAccounts: Array<PublicKey> = [];
    for (let i = 0; i < aggregator.oracleRequestBatchSize; ++i) {
      remainingAccounts.push(aggregator.currentRound.oraclePubkeysData[i]);
    }
    // TODO: load multiple accounts with one call here.
    const oraclePromises = [];
    for (let i = 0; i < aggregator.oracleRequestBatchSize; ++i) {
      const oracleAccount = new OracleAccount({
        program: this.program,
        publicKey: aggregator.currentRound.oraclePubkeysData[i],
      });
      oraclePromises.push(oracleAccount.loadData());
    }
    for (const promise of oraclePromises) {
      remainingAccounts.push((await promise).tokenAccount);
    }
    const queuePubkey = aggregator.currentRound.oracleQueuePubkey;
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: queuePubkey,
    });
    const queue = await queueAccount.loadData();
    const [permissionAccount, permissionBump] =
      await PermissionAccount.fromSeed(
        this.program,
        queue.authority,
        queuePubkey,
        this.publicKey
      );
    const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(
      this.program,
      queueAccount,
      this
    );
    const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      this.program
    );
    const escrow = (await leaseAccount.loadData()).escrow;
    return await this.program.rpc.aggregatorSaveResult(
      {
        oracleIdx: params.oracleIdx,
        error: params.error,
        value: params.value.toString(),
        jobsHash: Buffer.from(""),
        minResponse: params.minResponse.toString(),
        maxResponse: params.maxResponse.toString(),
        permissionBump,
        leaseBump,
        stateBump,
      },
      {
        accounts: {
          aggregator: this.publicKey,
          oracle: oracleAccount.publicKey,
          oracleQueue: queueAccount.publicKey,
          authority: queue.authority,
          permission: permissionAccount.publicKey,
          lease: leaseAccount.publicKey,
          escrow,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          programState: programStateAccount.publicKey,
        },
        remainingAccounts: remainingAccounts.map((pubkey: PublicKey) => {
          return { isSigner: false, isWritable: true, pubkey };
        }),
        signers: [oracleAccount.keypair],
      }
    );
  }
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
export class JobAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * JobAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Load and parse JobAccount data based on the program IDL.
   * @return JobAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const job = await this.program.account.jobAccountData.fetch(this.publicKey);
    return job;
  }

  /**
   * Load and parse the protobuf from the raw buffer stored in the JobAccount.
   * @return OracleJob
   */
  async loadJob(): Promise<OracleJob> {
    let job = await this.loadData();
    return OracleJob.decodeDelimited(job.data);
  }

  /**
   * Load and parse JobAccount data based on the program IDL from a buffer.
   * @return JobAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  static decode(program: anchor.Program, buf: Buffer): any {
    const typesCoder = new anchor.TypesCoder(program.idl);
    return typesCoder.decode("JobAccountData", buf);
  }

  /**
   * Create and initialize the JobAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated JobAccount.
   */
  static async create(
    program: anchor.Program,
    params: JobInitParams
  ): Promise<JobAccount> {
    const jobAccount = params.keypair ?? anchor.web3.Keypair.generate();
    const size =
      212 + params.data.length + (params.variables?.join("")?.length ?? 0);
    await program.rpc.jobInit(
      {
        id: params.id ?? Buffer.from(""),
        expiration: params.expiration ?? new anchor.BN(0),
        data: params.data,
        variables:
          params.variables?.map((item) => Buffer.from("")) ??
          new Array<Buffer>(),
      },
      {
        accounts: {
          job: jobAccount.publicKey,
        },
        signers: [jobAccount],
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: jobAccount.publicKey,
            space: size,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                size
              ),
            programId: program.programId,
          }),
        ],
      }
    );
    return new JobAccount({ program, keypair: jobAccount });
  }
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
export enum SwitchboardPermission {
  PERMIT_ORACLE_HEARTBEAT = "permitOracleHeartbeat",
  PERMIT_ORACLE_QUEUE_USAGE = "permitOracleQueueUsage",
}
/**
 * A Switchboard account representing a permission or privilege granted by one
 * account signer to another account.
 */
export class PermissionAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * AggregatorAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Load and parse PermissionAccount data based on the program IDL.
   * @return PermissionAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const permission: any =
      await this.program.account.permissionAccountData.fetch(this.publicKey);
    permission.ebuf = undefined;
    return permission;
  }

  /**
   * Get the size of a PermissionAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.permissionAccountData.size;
  }

  /**
   * Create and initialize the PermissionAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated PermissionAccount.
   */
  static async create(
    program: anchor.Program,
    params: PermissionInitParams
  ): Promise<PermissionAccount> {
    const [permissionAccount, permissionBump] =
      await PermissionAccount.fromSeed(
        program,
        params.authority,
        params.granter,
        params.grantee
      );
    await program.rpc.permissionInit(
      {
        permissionBump,
      },
      {
        accounts: {
          permission: permissionAccount.publicKey,
          authority: params.authority,
          granter: params.granter,
          grantee: params.grantee,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
        signers: [permissionAccount.keypair],
      }
    );
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
  static async fromSeed(
    program: anchor.Program,
    authority: PublicKey,
    granter: PublicKey,
    grantee: PublicKey
  ): Promise<[PermissionAccount, number]> {
    const [pubkey, bump] = await anchor.utils.publicKey.findProgramAddressSync(
      [
        Buffer.from("PermissionAccountData"),
        authority.toBytes(),
        granter.toBytes(),
        grantee.toBytes(),
      ],
      program.programId
    );
    return [new PermissionAccount({ program, publicKey: pubkey }), bump];
  }

  /**
   * Sets the permission in the PermissionAccount
   * @param params.
   * @return TransactionSignature.
   */
  async set(params: PermissionSetParams): Promise<TransactionSignature> {
    const permission = new Map<string, null>();
    permission.set(params.permission.toString(), null);
    return await this.program.rpc.permissionSet(
      {
        permission: Object.fromEntries(permission),
        enable: params.enable,
      },
      {
        accounts: {
          permission: this.publicKey,
          authority: params.authority.publicKey,
        },
        signers: [params.authority],
      }
    );
  }
}

/**
 * Parameters for initializing OracleQueueAccount
 */
export interface OracleQueueInitParams {
  /**
   *  A name to assign to this OracleQueue
   */
  id?: Buffer;
  /**
   *  Buffer for queue metadata
   */
  metadata?: Buffer;
  /**
   *  Slashing mechanisms for oracles on this queue.
   */
  slashingCurve?: Buffer;
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
  oracleTimout?: anchor.BN;
}

/**
 * A Switchboard account representing a queue for distributing oracles to
 * permitted data feeds.
 */
export class OracleQueueAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * OracleQueueAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Load and parse OracleQueueAccount data based on the program IDL.
   * @return OracleQueueAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const queue: any = await this.program.account.oracleQueueAccountData.fetch(
      this.publicKey
    );
    queue.ebuf = undefined;
    return queue;
  }

  /**
   * Get the size of an OracleQueueAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.oracleQueueAccountData.size;
  }

  /**
   * Create and initialize the OracleQueueAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated OracleQueueAccount.
   */
  static async create(
    program: anchor.Program,
    params: OracleQueueInitParams
  ): Promise<OracleQueueAccount> {
    const oracleQueueAccount = anchor.web3.Keypair.generate();
    const size = program.account.oracleQueueAccountData.size;
    await program.rpc.oracleQueueInit(
      {
        id: (params.id ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 64),
        slashingCurve: params.slashingCurve?.slice(0, 256) ?? null,
        reward: params.reward ?? new anchor.BN(0),
        minStake: params.minStake ?? new anchor.BN(0),
        feedProbationPeriod: params.feedProbationPeriod ?? 0,
        oracleTimout: params.oracleTimout ?? 180,
      },
      {
        accounts: {
          oracleQueue: oracleQueueAccount.publicKey,
          authority: params.authority,
        },
        signers: [oracleQueueAccount],
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: oracleQueueAccount.publicKey,
            space: size,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                size
              ),
            programId: program.programId,
          }),
        ],
      }
    );
    return new OracleQueueAccount({ program, keypair: oracleQueueAccount });
  }
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
 * A Switchboard account representing a lease for managing funds for oracle payouts
 * for fulfilling feed updates.
 */
export class LeaseAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * LeaseAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Loads a LeaseAccount from the expected PDA seed format.
   * @param leaser The leaser pubkey to be incorporated into the account seed.
   * @param target The target pubkey to be incorporated into the account seed.
   * @return LeaseAccount and PDA bump.
   */
  static async fromSeed(
    program: anchor.Program,
    queueAccount: OracleQueueAccount,
    aggregatorAccount: AggregatorAccount
  ): Promise<[LeaseAccount, number]> {
    const [pubkey, bump] = await anchor.utils.publicKey.findProgramAddressSync(
      [
        Buffer.from("LeaseAccountData"),
        queueAccount.publicKey.toBytes(),
        aggregatorAccount.publicKey.toBytes(),
      ],
      program.programId
    );
    return [new LeaseAccount({ program, publicKey: pubkey }), bump];
  }

  /**
   * Load and parse LeaseAccount data based on the program IDL.
   * @return LeaseAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const lease: any = await this.program.account.leaseAccountData.fetch(
      this.publicKey
    );
    lease.ebuf = undefined;
    return lease;
  }

  /**
   * Get the size of a LeaseAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.leaseAccountData.size;
  }

  /**
   * Create and initialize the LeaseAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated LeaseAccount.
   */
  static async create(
    program: anchor.Program,
    params: LeaseInitParams
  ): Promise<LeaseAccount> {
    const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      program
    );
    const switchTokenMint = await programStateAccount.getTokenMint();
    const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(
      program,
      params.oracleQueueAccount,
      params.aggregatorAccount
    );
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
    await program.rpc.leaseInit(
      {
        loadAmount: params.loadAmount,
        stateBump,
        leaseBump,
        withdrawAuthority: params.withdrawAuthority ?? PublicKey.default,
      },
      {
        accounts: {
          programState: programStateAccount.publicKey,
          lease: leaseAccount.publicKey,
          queue: params.oracleQueueAccount.publicKey,
          aggregator: params.aggregatorAccount.publicKey,
          systemProgram: SystemProgram.programId,
          funder: params.funder,
          payer: program.provider.wallet.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          escrow,
          owner: params.funderAuthority.publicKey,
        },
        signers: [params.funderAuthority],
      }
    );
    return new LeaseAccount({ program, publicKey: leaseAccount.publicKey });
  }
}

/**
 * Parameters for initializing a CrankAccount
 */
export interface CrankInitParams {
  /**
   *  Buffer specifying crank id
   */
  id?: Buffer;
  /**
   *  Buffer specifying crank metadata
   */
  metadata?: Buffer;
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
export class CrankRow {
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
export class CrankAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * CrankAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Load and parse CrankAccount data based on the program IDL.
   * @return CrankAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const lease: any = await this.program.account.crankAccountData.fetch(
      this.publicKey
    );
    lease.ebuf = undefined;
    return lease;
  }

  /**
   * Get the size of a CrankAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.crankAccountData.size;
  }

  /**
   * Create and initialize the CrankAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated CrankAccount.
   */
  static async create(
    program: anchor.Program,
    params: CrankInitParams
  ): Promise<CrankAccount> {
    const crankAccount = anchor.web3.Keypair.generate();
    const size = program.account.crankAccountData.size;
    await program.rpc.crankInit(
      {
        id: (params.id ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 64),
      },
      {
        accounts: {
          crank: crankAccount.publicKey,
          queue: params.queueAccount.publicKey,
        },
        signers: [crankAccount],
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: crankAccount.publicKey,
            space: size,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                size
              ),
            programId: program.programId,
          }),
        ],
      }
    );
    return new CrankAccount({ program, keypair: crankAccount });
  }

  // TODO: Add permission for the crank addition. Could just be permission for feed on queue
  /**
   * Pushes a new aggregator onto the crank.
   * @param aggregator The Aggregator account to push on the crank.
   * @return TransactionSignature
   */
  async push(params: CrankPushParams): Promise<TransactionSignature> {
    const aggregatorAccount: AggregatorAccount = params.aggregatorAccount;
    const crank = await this.loadData();
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: crank.queuePubkey,
    });
    const queue = await queueAccount.loadData();
    const queueAuthority = queue.authority;
    const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(
      this.program,
      queueAccount,
      aggregatorAccount
    );
    let lease = null;
    try {
      lease = await leaseAccount.loadData();
    } catch (_) {
      throw new Error("A requested pda account has not been initialized.");
    }

    const [permissionAccount, permissionBump] =
      await PermissionAccount.fromSeed(
        this.program,
        queueAuthority,
        queueAccount.publicKey,
        aggregatorAccount.publicKey
      );
    try {
      await permissionAccount.loadData();
    } catch (_) {
      throw new Error("A requested pda account has not been initialized.");
    }
    const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      this.program
    );
    return await this.program.rpc.crankPush(
      {
        stateBump,
        permissionBump,
      },
      {
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
      }
    );
  }

  /**
   * Pops an aggregator from the crank.
   * @param params
   * @return TransactionSignature
   */
  async pop(params: CrankPopParams): Promise<TransactionSignature> {
    let crank = await this.loadData();
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: crank.queuePubkey,
    });
    const queueAuthority = (await queueAccount.loadData()).authority;
    const peakAggKeys = await this.peakNext(6);
    let remainingAccounts: Array<PublicKey> = peakAggKeys.slice();
    const leaseBumpsMap: Map<string, number> = new Map();
    const permissionBumpsMap: Map<string, number> = new Map();
    for (const feedKey of peakAggKeys) {
      const aggregatorAccount = new AggregatorAccount({
        program: this.program,
        publicKey: feedKey,
      });
      const [leaseAccount, leaseBump] = await LeaseAccount.fromSeed(
        this.program,
        new OracleQueueAccount({
          program: this.program,
          publicKey: crank.queuePubkey,
        }),
        aggregatorAccount
      );
      const escrow = (await leaseAccount.loadData()).escrow;
      const [permissionAccount, permissionBump] =
        await PermissionAccount.fromSeed(
          this.program,
          queueAuthority,
          queueAccount.publicKey,
          feedKey
        );
      remainingAccounts.push(leaseAccount.publicKey);
      remainingAccounts.push(escrow);
      remainingAccounts.push(permissionAccount.publicKey);
      leaseBumpsMap.set(feedKey.toBase58(), leaseBump);
      permissionBumpsMap.set(feedKey.toBase58(), permissionBump);
    }
    // TODO: this sort might need fixing to align
    remainingAccounts.sort((a: PublicKey, b: PublicKey) =>
      a.toBuffer().compare(b.toBuffer())
    );
    const leaseBumps: Array<number> = [];
    const permissionBumps: Array<number> = [];
    // Map bumps to the index of their corresponding feeds.
    for (const key of remainingAccounts) {
      leaseBumps.push(leaseBumpsMap.get(key.toBase58()) ?? 0);
      permissionBumps.push(permissionBumpsMap.get(key.toBase58()) ?? 0);
    }
    const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      this.program
    );
    return await this.program.rpc.crankPop(
      {
        stateBump,
        leaseBumps: Buffer.from(leaseBumps),
        permissionBumps: Buffer.from(permissionBumps),
      },
      {
        accounts: {
          crank: this.publicKey,
          oracleQueue: crank.queuePubkey,
          queueAuthority,
          programState: programStateAccount.publicKey,
          payoutWallet: params.payoutWallet,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        remainingAccounts: remainingAccounts.map((pubkey: PublicKey) => {
          return { isSigner: false, isWritable: true, pubkey };
        }),
      }
    );
  }

  /**
   * Get an array of the next aggregator pubkeys to be popped from the crank, limited by n
   * @param n The limit of pubkeys to return.
   * @return Pubkey list of Aggregators next up to be popped.
   */
  async peakNext(n: number): Promise<Array<PublicKey>> {
    let crank = await this.loadData();
    let items = crank.pqData
      .slice(0, crank.pqSize)
      .sort((a: CrankRow, b: CrankRow) => a.nextTimestamp < b.nextTimestamp)
      .map((item: CrankRow) => item.pubkey)
      .slice(0, n);
    return items;
  }
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
export class OracleAccount {
  program: anchor.Program;
  publicKey: PublicKey;
  keypair?: Keypair;

  /**
   * OracleAccount constructor
   * @param params initialization params.
   */
  public constructor(params: AccountParams) {
    if (params.keypair === undefined && params.publicKey === undefined) {
      throw new Error(
        `${this.constructor.name}: User must provide either a publicKey or keypair for account use.`
      );
    }
    if (params.keypair !== undefined && params.publicKey !== undefined) {
      if (params.publicKey !== params.keypair.publicKey) {
        throw new Error(
          `${this.constructor.name}: provided pubkey and keypair mismatch.`
        );
      }
    }
    this.program = params.program;
    this.keypair = params.keypair;
    this.publicKey = params.publicKey ?? this.keypair.publicKey;
  }

  /**
   * Load and parse OracleAccount data based on the program IDL.
   * @return OracleAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const item: any = await this.program.account.oracleAccountData.fetch(
      this.publicKey
    );
    item.ebuf = undefined;
    return item;
  }

  /**
   * Get the size of an OracleAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.oracleAccountData.size;
  }

  /**
   * Create and initialize the OracleAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated OracleAccount.
   */
  static async create(
    program: anchor.Program,
    params: OracleInitParams
  ): Promise<OracleAccount> {
    const oracleAccount = anchor.web3.Keypair.generate();
    const size = program.account.oracleAccountData.size;
    const [programStateAccount, stateBump] = await ProgramStateAccount.fromSeed(
      program
    );
    const switchTokenMint = await programStateAccount.getTokenMint();
    const wallet = await switchTokenMint.createAccount(
      program.provider.wallet.publicKey
    );

    await program.rpc.oracleInit(
      {
        stateBump,
      },
      {
        accounts: {
          oracle: oracleAccount.publicKey,
          queue: params.queueAccount.publicKey,
          wallet,
          programState: programStateAccount.publicKey,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
        signers: [oracleAccount],
      }
    );
    return new OracleAccount({ program, keypair: oracleAccount });
  }

  /**
   * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
   * @return TransactionSignature.
   */
  async heartbeat(): Promise<TransactionSignature> {
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: (await this.loadData()).queuePubkey,
    });
    const queue = await queueAccount.loadData();
    let lastPubkey = this.publicKey;
    if (queue.size !== 0) {
      lastPubkey = queue.queue[queue.gcIdx];
    }
    const [permissionAccount, permissionBump] =
      await PermissionAccount.fromSeed(
        this.program,
        queue.authority,
        queueAccount.publicKey,
        this.publicKey
      );
    try {
      await permissionAccount.loadData();
    } catch (_) {
      throw new Error("A requested pda account has not been initialized.");
    }

    return await this.program.rpc.oracleHeartbeat(
      {
        permissionBump,
      },
      {
        accounts: {
          oracle: this.publicKey,
          gcOracle: lastPubkey,
          oracleQueue: queueAccount.publicKey,
          permission: permissionAccount.publicKey,
        },
        signers: [this.keypair],
      }
    );
  }
}
