import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionSignature,
} from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import Big from "big.js";
import * as crypto from "crypto";
import assert from "assert";

/**
 * Switchboard precisioned representation of numbers.
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
    let mantissa: anchor.BN = big.c
      .map((n) => new anchor.BN(n, 10))
      .reduce((res: anchor.BN, n: anchor.BN) => {
        res = res.mul(new anchor.BN(10, 10));
        res = res.add(n);
        return res;
      });

    // Set the scale. Big.exponenet sets scale from the opposite side
    // SwitchboardDecimal does.
    let scale = big.c.length - big.e - 1;
    while (scale < 0) {
      mantissa = mantissa.mul(new anchor.BN(10, 10));
      scale += 1;
    }
    assert.ok(scale >= 0, `${big.c.length}, ${big.e}`);

    // Set sign for the coefficient (mantissa)
    mantissa = mantissa.mul(new anchor.BN(big.s, 10));

    const result = new SwitchboardDecimal(mantissa, scale);
    assert.ok(
      big.sub(result.toBig()).abs().lt(new Big(0.00005)),
      `${result.toBig()} ${big}`
    );
    return result;
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
    const scale = new Big(10).pow(this.scale);
    return new Big(this.mantissa.toString()).div(scale);
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
  static fromSeed(program: anchor.Program): [ProgramStateAccount, number] {
    const [statePubkey, stateBump] =
      anchor.utils.publicKey.findProgramAddressSync(
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
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
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
          authority: program.provider.wallet.publicKey,
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
      anchor.utils.publicKey.findProgramAddressSync(
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
    return Buffer.from(aggregator.name).toString("utf8");
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
   * Speciifies if the aggregator settings recommend reporting a new value
   * @param value The value which we are evaluating
   * @param aggregator The loaded aggegator schema
   * @returns boolean
   */
  static async shouldReportValue(
    value: Big,
    aggregator: any
  ): Promise<boolean> {
    if ((aggregator.latestConfirmedRound?.numSuccess ?? 0) === 0) {
      return true;
    }
    const timestamp: anchor.BN = new anchor.BN(Math.round(Date.now() / 1000));
    if (aggregator.startAfter.gt(timestamp)) {
      return false;
    }
    const varianceThreshold: Big = SwitchboardDecimal.from(
      aggregator.varianceThreshold
    ).toBig();
    const latestResult: Big = SwitchboardDecimal.from(
      aggregator.latestConfirmedRound.result
    ).toBig();
    const forceReportPeriod: anchor.BN = aggregator.forceReportPeriod;
    const lastTimestamp: anchor.BN =
      aggregator.latestConfirmedRound.roundOpenTimestamp;
    if (lastTimestamp.add(aggregator.forceReportPeriod).lt(timestamp)) {
      return true;
    }
    if (value.lt(latestResult.minus(varianceThreshold))) {
      return true;
    }
    if (value.gt(latestResult.add(varianceThreshold))) {
      return true;
    }
    return false;
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
    const results: Array<{ oracleAccount: OracleAccount; value: Big }> = [];
    for (let i = 0; i < aggregator.oracleRequestBatchSize; ++i) {
      if (aggregator.latestConfirmedRound.mediansFulfilled[i] === true) {
        results.push({
          oracleAccount: new OracleAccount({
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
  produceJobsHash(jobs: Array<OracleJob>): crypto.Hash {
    const hash = crypto.createHash("sha256");
    for (const job of jobs) {
      const jobHasher = crypto.createHash("sha256");
      jobHasher.update(OracleJob.encodeDelimited(job).finish());
      hash.update(jobHasher.digest());
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

  async loadHashes(aggregator?: any): Promise<Array<Buffer>> {
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
      return decoded.hash;
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
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    const aggregatorAccount = params.keypair ?? anchor.web3.Keypair.generate();
    const authority = params.authority ?? aggregatorAccount.publicKey;
    const size = program.account.aggregatorAccountData.size;
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
    const state = await stateAccount.loadData();
    await program.rpc.aggregatorInit(
      {
        name: (params.name ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 128),
        batchSize: params.batchSize,
        minOracleResults: params.minRequiredOracleResults,
        minJobResults: params.minRequiredJobResults,
        minUpdateDelaySeconds: params.minUpdateDelaySeconds,
        varianceThreshold: Object.assign(
          {},
          SwitchboardDecimal.fromBig(new Big(params.varianceThreshold ?? 0))
        ),
        forceReportPeriod: params.forceReportPeriod ?? new anchor.BN(0),
        expiration: params.expiration ?? new anchor.BN(0),
        stateBump,
      },
      {
        accounts: {
          aggregator: aggregatorAccount.publicKey,
          authority,
          queue: params.queueAccount.publicKey,
          authorWallet: params.authorWallet ?? state.tokenVault,
          programState: stateAccount.publicKey,
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
  async addJob(
    job: JobAccount,
    authority?: Keypair
  ): Promise<TransactionSignature> {
    authority = authority ?? this.keypair;
    return await this.program.rpc.aggregatorAddJob(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
          job: job.publicKey,
        },
        signers: [authority],
      }
    );
  }

  /**
   * RPC to remove a job from an aggregtor.
   * @param job JobAccount to be removed from the aggregator
   * @return TransactionSignature
   */
  async removeJob(
    job: JobAccount,
    authority?: Keypair
  ): Promise<TransactionSignature> {
    authority = authority ?? this.keypair;
    return await this.program.rpc.aggregatorRemoveJob(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
          job: job.publicKey,
        },
        signers: [authority],
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
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );

    const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
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

    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
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
          dataBuffer: queue.dataBuffer,
        },
      }
    );
  }

  async getOracleIndex(oraclePubkey: PublicKey): Promise<number> {
    const aggregator = await this.loadData();
    for (let i = 0; i < aggregator.oracleRequestBatchSize; i++) {
      if (aggregator.currentRound.oraclePubkeysData[i].equals(oraclePubkey)) {
        return i;
      }
    }
    return -1;
  }

  async saveResult(
    aggregator: any,
    oracleAccount: OracleAccount,
    params: AggregatorSaveResultParams
  ): Promise<TransactionSignature> {
    return await this.program.provider.send(
      await this.saveResultTxn(aggregator, oracleAccount, params)
    );
  }

  /**
   * RPC for an oracle to save a result to an aggregator round.
   * @param oracleAccount The oracle account submitting a result.
   * @param params
   * @return TransactionSignature
   */
  async saveResultTxn(
    aggregator: any,
    oracleAccount: OracleAccount, // TODO: move to params.
    params: AggregatorSaveResultParams
  ): Promise<Transaction> {
    const payerKeypair = Keypair.fromSecretKey(
      (this.program.provider.wallet as any).payer.secretKey
    );
    const remainingAccounts: Array<PublicKey> = [];
    for (let i = 0; i < aggregator.oracleRequestBatchSize; ++i) {
      remainingAccounts.push(aggregator.currentRound.oraclePubkeysData[i]);
    }
    const queuePubkey = aggregator.queuePubkey;
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: queuePubkey,
    });
    const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
      this.program,
      queueAccount,
      this
    );
    const accountDatas = await anchor.utils.rpc.getMultipleAccounts(
      this.program.provider.connection,
      [queueAccount.publicKey, leaseAccount.publicKey].concat(
        aggregator.currentRound.oraclePubkeysData.slice(
          0,
          aggregator.oracleRequestBatchSize
        )
      )
    );
    const [queueAccountData, leaseAccountData] = accountDatas.slice(0, 2);
    const oracleAccountDatas = accountDatas.slice(2);
    const coder = new anchor.AccountsCoder(this.program.idl);
    oracleAccountDatas?.map((item) => {
      const oracle = coder.decode("OracleAccountData", item.account.data);
      remainingAccounts.push(oracle.tokenAccount);
    });
    const queue = coder.decode(
      "OracleQueueAccountData",
      queueAccountData.account.data
    );
    const escrow = coder.decode(
      "LeaseAccountData",
      leaseAccountData.account.data
    ).escrow;
    const [feedPermissionAccount, feedPermissionBump] =
      PermissionAccount.fromSeed(
        this.program,
        queue.authority,
        queuePubkey,
        this.publicKey
      );
    const [oraclePermissionAccount, oraclePermissionBump] =
      PermissionAccount.fromSeed(
        this.program,
        queue.authority,
        queuePubkey,
        oracleAccount.publicKey
      );
    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );
    const digest = this.produceJobsHash(params.jobs).digest();
    return this.program.transaction.aggregatorSaveResult(
      {
        oracleIdx: params.oracleIdx,
        error: params.error,
        value: Object.assign({}, SwitchboardDecimal.fromBig(params.value)),
        jobsChecksum: digest,
        minResponse: Object.assign(
          {},
          SwitchboardDecimal.fromBig(params.minResponse)
        ),
        maxResponse: Object.assign(
          {},
          SwitchboardDecimal.fromBig(params.maxResponse)
        ),
        feedPermissionBump,
        oraclePermissionBump,
        leaseBump,
        stateBump,
      },
      {
        accounts: {
          aggregator: this.publicKey,
          oracle: oracleAccount.publicKey,
          oracleAuthority: payerKeypair.publicKey,
          oracleQueue: queueAccount.publicKey,
          queueAuthority: queue.authority,
          feedPermission: feedPermissionAccount.publicKey,
          oraclePermission: oraclePermissionAccount.publicKey,
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
  /**
   *  An optional wallet for receiving kickbacks from job usage in feeds.
   *  Defaults to token vault.
   */
  authorWallet?: PublicKey;
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
    const coder = new anchor.Coder(program.idl);
    return coder.accounts.decode("JobAccountData", buf);
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
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    const jobAccount = params.keypair ?? anchor.web3.Keypair.generate();
    const size =
      276 + params.data.length + (params.variables?.join("")?.length ?? 0);
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
    const state = await stateAccount.loadData();
    await program.rpc.jobInit(
      {
        name: params.name ?? Buffer.from(""),
        expiration: params.expiration ?? new anchor.BN(0),
        data: params.data,
        variables:
          params.variables?.map((item) => Buffer.from("")) ??
          new Array<Buffer>(),
        stateBump,
      },
      {
        accounts: {
          job: jobAccount.publicKey,
          authorWallet: params.authorWallet ?? state.tokenVault,
          programState: stateAccount.publicKey,
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
   * PermissionAccount constructor
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
    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
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
  static fromSeed(
    program: anchor.Program,
    authority: PublicKey,
    granter: PublicKey,
    grantee: PublicKey
  ): [PermissionAccount, number] {
    const [pubkey, bump] = anchor.utils.publicKey.findProgramAddressSync(
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
    const queueData = [];
    const buffer =
      (await this.program.provider.connection.getAccountInfo(queue.dataBuffer))
        ?.data ?? Buffer.from("");
    const rowSize = 32;
    for (let i = 0; i < buffer.length; i += rowSize) {
      if (buffer.length - i < rowSize) {
        break;
      }
      const pubkeyBuf = buffer.slice(i, i + rowSize);
      queueData.push(new PublicKey(pubkeyBuf));
    }
    queue.queue = queueData;
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
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    const oracleQueueAccount = anchor.web3.Keypair.generate();
    const buffer = anchor.web3.Keypair.generate();
    const size = program.account.oracleQueueAccountData.size;
    const queueSize = (params.queueSize ?? 500) * 32;
    const tx = new Transaction();
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: program.provider.wallet.publicKey,
        newAccountPubkey: buffer.publicKey,
        space: queueSize,
        lamports:
          await program.provider.connection.getMinimumBalanceForRentExemption(
            queueSize
          ),
        programId: program.programId,
      })
    );
    const recentBlockhash = (
      await program.provider.connection.getRecentBlockhashAndContext()
    ).value.blockhash;
    tx.recentBlockhash = recentBlockhash;
    tx.sign(payerKeypair, buffer);
    await program.provider.send(tx);
    await program.rpc.oracleQueueInit(
      {
        name: (params.name ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 64),
        reward: params.reward ?? new anchor.BN(0),
        minStake: params.minStake ?? new anchor.BN(0),
        feedProbationPeriod: params.feedProbationPeriod ?? 0,
        oracleTimeout: params.oracleTimeout ?? 180,
        slashingEnabled: params.slashingEnabled ?? false,
        varianceToleranceMultiplier: Object.assign(
          {},
          SwitchboardDecimal.fromBig(
            new Big(params.varianceToleranceMultiplier ?? 2)
          )
        ),
        authority: params.authority,
        consecutiveFeedFailureLimit:
          params.consecutiveFeedFailureLimit ?? new anchor.BN(1000),
        consecutiveOracleFailureLimit:
          params.consecutiveOracleFailureLimit ?? new anchor.BN(1000),
        minimumDelaySeconds: params.minimumDelaySeconds ?? 5,
        queueSize,
      },
      {
        signers: [oracleQueueAccount],
        accounts: {
          oracleQueue: oracleQueueAccount.publicKey,
          authority: params.authority,
          buffer: buffer.publicKey,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
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
  static fromSeed(
    program: anchor.Program,
    queueAccount: OracleQueueAccount,
    aggregatorAccount: AggregatorAccount
  ): [LeaseAccount, number] {
    const [pubkey, bump] = anchor.utils.publicKey.findProgramAddressSync(
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
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    const [programStateAccount, stateBump] =
      ProgramStateAccount.fromSeed(program);
    const switchTokenMint = await programStateAccount.getTokenMint();
    const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
      program,
      params.oracleQueueAccount,
      params.aggregatorAccount
    );
    const escrow = await switchTokenMint.createAccount(payerKeypair.publicKey);
    // Set lease to be the close authority.
    await switchTokenMint.setAuthority(
      escrow,
      leaseAccount.publicKey,
      "CloseAccount",
      payerKeypair.publicKey,
      [payerKeypair]
    );
    // Set program to be escrow authority.
    await switchTokenMint.setAuthority(
      escrow,
      programStateAccount.publicKey,
      "AccountOwner",
      payerKeypair.publicKey,
      [payerKeypair]
    );
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

  /**
   * Adds fund to a LeaseAccount. Note that funds can always be withdrawn by
   * the withdraw authority if one was set on lease initialization.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   */
  async extend(program: anchor.Program, params: LeaseExtendParams) {
    const lease = await this.loadData();
    const escrow = lease.escrow;
    const queue = lease.queue;
    const aggregator = lease.aggregator;
    const [programStateAccount, stateBump] =
      ProgramStateAccount.fromSeed(program);
    const switchTokenMint = await programStateAccount.getTokenMint();
    const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
      program,
      new OracleQueueAccount({ program, publicKey: queue }),
      new AggregatorAccount({ program, publicKey: aggregator })
    );
    await program.rpc.leaseExtend(
      {
        loadAmount: params.loadAmount,
        stateBump,
        leaseBump,
      },
      {
        accounts: {
          lease: leaseAccount.publicKey,
          aggregator,
          queue,
          funder: params.funder,
          owner: params.funderAuthority.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          escrow,
          programState: programStateAccount.publicKey,
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

  static from(buf: Buffer): CrankRow {
    const pubkey = new PublicKey(buf.slice(0, 32));
    const nextTimestamp = new anchor.BN(buf.slice(32, 40), "le");
    console.log(`!!! ${nextTimestamp.toNumber()}`);
    const res = new CrankRow();
    res.pubkey = pubkey;
    res.nextTimestamp = nextTimestamp;
    return res;
  }
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
    const crank: any = await this.program.account.crankAccountData.fetch(
      this.publicKey
    );
    const pqData = [];
    const buffer =
      (await this.program.provider.connection.getAccountInfo(crank.dataBuffer))
        ?.data ?? Buffer.from("");
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
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    const crankAccount = anchor.web3.Keypair.generate();
    const buffer = anchor.web3.Keypair.generate();
    const size = program.account.crankAccountData.size;
    const crankSize = (params.maxRows ?? 500) * 40;
    const tx = new Transaction();
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: program.provider.wallet.publicKey,
        newAccountPubkey: buffer.publicKey,
        space: crankSize,
        lamports:
          await program.provider.connection.getMinimumBalanceForRentExemption(
            crankSize
          ),
        programId: program.programId,
      })
    );
    const recentBlockhash = (
      await program.provider.connection.getRecentBlockhashAndContext()
    ).value.blockhash;
    tx.recentBlockhash = recentBlockhash;
    tx.sign(payerKeypair, buffer);
    await program.provider.send(tx);
    await program.rpc.crankInit(
      {
        name: (params.name ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 64),
        crankSize,
      },
      {
        signers: [crankAccount],
        accounts: {
          crank: crankAccount.publicKey,
          queue: params.queueAccount.publicKey,
          buffer: buffer.publicKey,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
      }
    );
    return new CrankAccount({ program, keypair: crankAccount });
  }

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
    const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
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

    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
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
    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
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
          dataBuffer: crank.dataBuffer,
        },
      }
    );
  }

  /**
   * Pops an aggregator from the crank.
   * @param params
   * @return TransactionSignature
   */
  async popTxn(params: CrankPopParams): Promise<Transaction> {
    const next = params.readyPubkeys ?? (await this.peakNextReady(5));
    if (next.length === 0) {
      throw new Error("Crank is not ready to be turned.");
    }
    const remainingAccounts: Array<PublicKey> = [];
    const leaseBumpsMap: Map<string, number> = new Map();
    const permissionBumpsMap: Map<string, number> = new Map();
    const leasePubkeys = [];
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: params.queuePubkey,
    });

    for (const row of next) {
      const aggregatorAccount = new AggregatorAccount({
        program: this.program,
        publicKey: row,
      });
      const [leaseAccount, leaseBump] = LeaseAccount.fromSeed(
        this.program,
        queueAccount,
        aggregatorAccount
      );
      const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
        this.program,
        params.queueAuthority,
        params.queuePubkey,
        row
      );
      leasePubkeys.push(leaseAccount.publicKey);
      remainingAccounts.push(aggregatorAccount.publicKey);
      remainingAccounts.push(leaseAccount.publicKey);
      remainingAccounts.push(permissionAccount.publicKey);
      leaseBumpsMap.set(row.toBase58(), leaseBump);
      permissionBumpsMap.set(row.toBase58(), permissionBump);
    }
    const coder = new anchor.AccountsCoder(this.program.idl);

    const accountDatas = await anchor.utils.rpc.getMultipleAccounts(
      this.program.provider.connection,
      [this.publicKey, queueAccount.publicKey].concat(leasePubkeys)
    );
    const crank = coder.decode(
      "CrankAccountData",
      accountDatas[0].account.data
    );
    const queue = coder.decode(
      "OracleQueueAccountData",
      accountDatas[1].account.data
    );
    accountDatas.slice(2).map((item) => {
      let decoded = coder.decode("LeaseAccountData", item.account.data);
      remainingAccounts.push(decoded.escrow);
    });
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
    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );
    // const promises: Array<Promise<TransactionSignature>> = [];
    return this.program.transaction.crankPop(
      {
        stateBump,
        leaseBumps: Buffer.from(leaseBumps),
        permissionBumps: Buffer.from(permissionBumps),
        nonce: params.nonce ?? null,
      },
      {
        accounts: {
          crank: this.publicKey,
          oracleQueue: params.queuePubkey,
          queueAuthority: params.queueAuthority,
          programState: programStateAccount.publicKey,
          payoutWallet: params.payoutWallet,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          crankDataBuffer: crank.dataBuffer,
          queueDataBuffer: queue.dataBuffer,
        },
        remainingAccounts: remainingAccounts.map((pubkey: PublicKey) => {
          return { isSigner: false, isWritable: true, pubkey };
        }),
      }
    );
  }

  /**
   * Pops an aggregator from the crank.
   * @param params
   * @return TransactionSignature
   */
  async pop(params: CrankPopParams): Promise<TransactionSignature> {
    return await this.program.provider.send(await this.popTxn(params));
  }

  /**
   * Get an array of the next aggregator pubkeys to be popped from the crank, limited by n
   * @param n The limit of pubkeys to return.
   * @return Pubkey list of Aggregators and next timestamp to be popped, ordered by timestamp.
   */
  async peakNextWithTime(n: number): Promise<Array<CrankRow>> {
    let crank = await this.loadData();
    let items = crank.pqData
      .slice(0, crank.pqSize)
      .sort((a: CrankRow, b: CrankRow) => a.nextTimestamp.sub(b.nextTimestamp))
      .slice(0, n);
    return items;
  }

  /**
   * Get an array of the next readily updateable aggregator pubkeys to be popped
   * from the crank, limited by n
   * @param n The limit of pubkeys to return.
   * @return Pubkey list of Aggregator pubkeys.
   */
  async peakNextReady(n: number): Promise<Array<PublicKey>> {
    const now = Math.floor(+new Date() / 1000);
    let crank = await this.loadData();
    let items = crank.pqData
      .slice(0, crank.pqSize)
      .sort((a: CrankRow, b: CrankRow) => a.nextTimestamp.sub(b.nextTimestamp))
      .filter((row: CrankRow) => now > row.nextTimestamp.toNumber())
      .map((item: CrankRow) => item.pubkey)
      .slice(0, n);
    return items;
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
      .sort((a: CrankRow, b: CrankRow) => a.nextTimestamp.sub(b.nextTimestamp))
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
   *  Buffer specifying oracle name
   */
  name?: Buffer;
  /**
   *  Buffer specifying oracle metadata
   */
  metadata?: Buffer;
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
    const payerKeypair = Keypair.fromSecretKey(
      (program.provider.wallet as any).payer.secretKey
    );
    const size = program.account.oracleAccountData.size;
    const [programStateAccount, stateBump] =
      ProgramStateAccount.fromSeed(program);

    const switchTokenMint = await programStateAccount.getTokenMint();
    const wallet = await switchTokenMint.createAccount(
      program.provider.wallet.publicKey
    );
    await switchTokenMint.setAuthority(
      wallet,
      programStateAccount.publicKey,
      "AccountOwner",
      payerKeypair,
      []
    );
    const [oracleAccount, oracleBump] = OracleAccount.fromSeed(program, wallet);

    await program.rpc.oracleInit(
      {
        name: (params.name ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 128),
        stateBump,
        oracleBump,
      },
      {
        accounts: {
          oracle: oracleAccount.publicKey,
          oracleAuthority: payerKeypair.publicKey,
          queue: params.queueAccount.publicKey,
          wallet,
          programState: programStateAccount.publicKey,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
      }
    );
    return new OracleAccount({ program, publicKey: oracleAccount.publicKey });
  }

  /**
   * Constructs OracleAccount from the static seed from which it was generated.
   * @return OracleAccount and PDA bump tuple.
   */
  static fromSeed(
    program: anchor.Program,
    wallet: PublicKey
  ): [OracleAccount, number] {
    const [oraclePubkey, oracleBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("OracleAccountData"), wallet.toBuffer()],
        program.programId
      );
    return [
      new OracleAccount({ program, publicKey: oraclePubkey }),
      oracleBump,
    ];
  }

  /**
   * Inititates a heartbeat for an OracleAccount, signifying oracle is still healthy.
   * @return TransactionSignature.
   */
  async heartbeat(): Promise<TransactionSignature> {
    const payerKeypair = Keypair.fromSecretKey(
      (this.program.provider.wallet as any).payer.secretKey
    );
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: (await this.loadData()).queuePubkey,
    });
    const queue = await queueAccount.loadData();
    let lastPubkey = this.publicKey;
    if (queue.size !== 0) {
      lastPubkey = queue.queue[queue.gcIdx];
    }
    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
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
    const oracle = await this.loadData();

    return await this.program.rpc.oracleHeartbeat(
      {
        permissionBump,
      },
      {
        accounts: {
          oracle: this.publicKey,
          oracleAuthority: payerKeypair.publicKey,
          tokenAccount: oracle.tokenAccount,
          gcOracle: lastPubkey,
          oracleQueue: queueAccount.publicKey,
          permission: permissionAccount.publicKey,
          dataBuffer: queue.dataBuffer,
        },
        signers: [this.keypair],
      }
    );
  }
}
