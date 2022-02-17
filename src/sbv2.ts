import * as anchor from "@project-serum/anchor";
import TransactionFactory from "@project-serum/anchor/dist/cjs/program/namespace/transaction";
import * as spl from "@solana/spl-token";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionSignature,
  sendAndConfirmTransaction,
  Signer,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import Big from "big.js";
import * as crypto from "crypto";

export const SBV2_DEVNET_PID = new PublicKey(
  "2TfB33aLaneQb5TNVwyDz3jSZXS6jdW2ARw1Dgf84XCG"
);
export const SBV2_MAINNET_PID = new PublicKey(
  "SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f"
);

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
    let mantissa: anchor.BN = new anchor.BN(big.c.join(""), 10);
    // Set the scale. Big.exponenet sets scale from the opposite side
    // SwitchboardDecimal does.
    let scale = big.c.slice(1).length - big.e;

    if (scale < 0) {
      mantissa = mantissa.mul(
        new anchor.BN(10, 10).pow(new anchor.BN(Math.abs(scale), 10))
      );
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
    if (big.sub(result.toBig()).abs().gt(new Big(0.00005))) {
      throw new Error(
        `SwitchboardDecimal: Converted decimal does not match original:\n` +
          `out: ${result.toBig().toNumber()} vs in: ${big.toNumber()}\n` +
          `-- result mantissa and scale: ${result.mantissa.toString()} ${result.scale.toString()}\n` +
          `${result} ${result.toBig()}`
      );
    }
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
    let mantissa: anchor.BN = new anchor.BN(this.mantissa, 10);
    let s = 1;
    let c: Array<number> = [];
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
    const result = new Big(0);
    if (c.length === 0) {
      return result;
    }
    result.s = s;
    result.c = c;
    result.e = e;
    return result;
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
export interface ProgramInitParams {
  mint?: PublicKey;
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
    const payerKeypair = getProgramPayer(program);
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(program);
    const psa = new ProgramStateAccount({
      program,
      publicKey: stateAccount.publicKey,
    });
    // Short circuit if already created.
    try {
      await psa.loadData();
      return psa;
    } catch (e) {}

    const recentBlockhash = (
      await program.provider.connection.getRecentBlockhash()
    ).blockhash;

    const txn = new Transaction({
      feePayer: payerKeypair.publicKey,
      recentBlockhash,
    });

    const signers: Signer[] = [
      {
        publicKey: payerKeypair.publicKey,
        secretKey: payerKeypair.secretKey,
      },
    ];

    let mint: PublicKey;
    let vault: PublicKey;

    if (params.mint === undefined) {
      // Create mint
      const mintKeypair = anchor.web3.Keypair.generate();
      mint = mintKeypair.publicKey;
      txn.add(
        SystemProgram.createAccount({
          fromPubkey: payerKeypair.publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          lamports: await spl.Token.getMinBalanceRentForExemptMint(
            program.provider.connection
          ),
          space: spl.MintLayout.span,
          programId: spl.TOKEN_PROGRAM_ID,
        })
      );
      txn.add(
        spl.Token.createInitMintInstruction(
          spl.TOKEN_PROGRAM_ID,
          mintKeypair.publicKey,
          9,
          payerKeypair.publicKey,
          null
        )
      );
      signers.push({
        publicKey: mintKeypair.publicKey,
        secretKey: mintKeypair.secretKey,
      });

      // Create PSA token vault
      const tokenVault = anchor.web3.Keypair.generate();
      vault = tokenVault.publicKey;
      txn.add(
        SystemProgram.createAccount({
          fromPubkey: payerKeypair.publicKey,
          newAccountPubkey: tokenVault.publicKey,
          lamports: await spl.Token.getMinBalanceRentForExemptAccount(
            program.provider.connection
          ),
          space: spl.AccountLayout.span,
          programId: spl.TOKEN_PROGRAM_ID,
        })
      );
      txn.add(
        spl.Token.createInitAccountInstruction(
          spl.TOKEN_PROGRAM_ID,
          mintKeypair.publicKey,
          tokenVault.publicKey,
          payerKeypair.publicKey // owner
        )
      );
      signers.push({
        publicKey: tokenVault.publicKey,
        secretKey: tokenVault.secretKey,
      });

      // Mint to tokenVault
      txn.add(
        spl.Token.createMintToInstruction(
          spl.TOKEN_PROGRAM_ID,
          mintKeypair.publicKey,
          tokenVault.publicKey,
          payerKeypair.publicKey,
          [payerKeypair],
          100_000_000
        )
      );
    } else {
      // Load existing mint
      mint = params.mint;
      const token = new spl.Token(
        program.provider.connection,
        mint,
        spl.TOKEN_PROGRAM_ID,
        payerKeypair
      );

      // Create PSA token vault
      const tokenVault = anchor.web3.Keypair.generate();
      vault = tokenVault.publicKey;
      txn.add(
        SystemProgram.createAccount({
          fromPubkey: payerKeypair.publicKey,
          newAccountPubkey: tokenVault.publicKey,
          lamports: await spl.Token.getMinBalanceRentForExemptAccount(
            program.provider.connection
          ),
          space: spl.AccountLayout.span,
          programId: spl.TOKEN_PROGRAM_ID,
        })
      );
      txn.add(
        spl.Token.createInitAccountInstruction(
          spl.TOKEN_PROGRAM_ID,
          mint,
          tokenVault.publicKey,
          payerKeypair.publicKey // owner
        )
      );
      signers.push({
        publicKey: tokenVault.publicKey,
        secretKey: tokenVault.secretKey,
      });
    }

    // Create Program State Account
    txn.add(
      program.instruction.programInit(
        {
          stateBump,
        },
        {
          accounts: {
            state: stateAccount.publicKey,
            authority: payerKeypair.publicKey,
            tokenMint: mint,
            vault,
            payer: payerKeypair.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
          },
        }
      )
    );

    await program.provider.connection.sendTransaction(txn, [
      {
        publicKey: payerKeypair.publicKey,
        secretKey: payerKeypair.secretKey,
      },
    ]);

    return psa;
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
          authority: authority.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        signers: [authority],
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
  /*
   * Authority keypair for the aggregator.
   */
  authority?: Keypair;
  /*
   * Number of elements for the history buffer to fit.
   */
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
 * Row structure of elements in the aggregator history buffer.
 */
export class AggregatorHistoryRow {
  /**
   *  Timestamp of the aggregator result.
   */
  timestamp: anchor.BN;
  /**
   *  Aggregator value at timestamp.
   */
  value: Big;

  static from(buf: Buffer): AggregatorHistoryRow {
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
    // eslint-disable-next-line no-control-regex
    return String.fromCharCode(...aggregator.name).replace(/\u0000/g, "");
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

  async loadHistory(aggregator?: any): Promise<Array<AggregatorHistoryRow>> {
    aggregator = aggregator ?? (await this.loadData());
    if (aggregator.historyBuffer == PublicKey.default) {
      return [];
    }
    const ROW_SIZE = 28;
    let buffer =
      (
        await this.program.provider.connection.getAccountInfo(
          aggregator.historyBuffer
        )
      )?.data ?? Buffer.from("");
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
      } else {
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
  async getLatestValue(
    aggregator?: any,
    decimals: number = 20
  ): Promise<Big | null> {
    aggregator = aggregator ?? (await this.loadData());
    if ((aggregator.latestConfirmedRound?.numSuccess ?? 0) === 0) {
      return null;
    }
    const mantissa = new Big(
      aggregator.latestConfirmedRound.result.mantissa.toString()
    );
    const scale = aggregator.latestConfirmedRound.result.scale;
    const oldDp = Big.DP;
    Big.DP = decimals;
    const result: Big = mantissa.div(new Big(10).pow(scale));
    Big.DP = oldDp;
    return result;
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
        varianceThreshold: SwitchboardDecimal.fromBig(
          new Big(params.varianceThreshold ?? 0)
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

  async setBatchSize(
    params: AggregatorSetBatchSizeParams
  ): Promise<TransactionSignature> {
    const program = this.program;
    const authority = params.authority ?? this.keypair;
    return await program.rpc.aggregatorSetBatchSize(
      {
        batchSize: params.batchSize,
      },
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
        },
        signers: [authority],
      }
    );
  }

  async setMinJobs(
    params: AggregatorSetMinJobsParams
  ): Promise<TransactionSignature> {
    const program = this.program;
    const authority = params.authority ?? this.keypair;
    return await program.rpc.aggregatorSetMinJobs(
      {
        minJobResults: params.minJobResults,
      },
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
        },
        signers: [authority],
      }
    );
  }

  async setMinOracles(
    params: AggregatorSetMinOraclesParams
  ): Promise<TransactionSignature> {
    const program = this.program;
    const authority = params.authority ?? this.keypair;
    return await program.rpc.aggregatorSetMinOracles(
      {
        minOracleResults: params.minOracleResults,
      },
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
        },
        signers: [authority],
      }
    );
  }

  async setHistoryBuffer(
    params: AggregatorSetHistoryBufferParams
  ): Promise<TransactionSignature> {
    const buffer = Keypair.generate();
    const program = this.program;
    const authority = params.authority ?? this.keypair;
    const HISTORY_ROW_SIZE = 28;
    const INSERT_IDX_SIZE = 4;
    const DISCRIMINATOR_SIZE = 8;
    const size =
      params.size * HISTORY_ROW_SIZE + INSERT_IDX_SIZE + DISCRIMINATOR_SIZE;
    return await program.rpc.aggregatorSetHistoryBuffer(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
          buffer: buffer.publicKey,
        },
        signers: [authority, buffer],
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: buffer.publicKey,
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
   * Prevent new jobs from being added to the feed.
   * @param authority The current authroity keypair
   * @return TransactionSignature
   */
  async lock(authority?: Keypair): Promise<TransactionSignature> {
    authority = authority ?? this.keypair;
    return await this.program.rpc.aggregatorLock(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          authority: authority.publicKey,
        },
        signers: [authority],
      }
    );
  }

  /**
   * Change the aggregator authority.
   * @param currentAuthority The current authroity keypair
   * @param newAuthority The new authority to set.
   * @return TransactionSignature
   */
  async setAuthority(
    newAuthority: PublicKey,
    currentAuthority?: Keypair
  ): Promise<TransactionSignature> {
    currentAuthority = currentAuthority ?? this.keypair;
    return await this.program.rpc.aggregatorSetAuthority(
      {},
      {
        accounts: {
          aggregator: this.publicKey,
          newAuthority,
          authority: currentAuthority.publicKey,
        },
        signers: [currentAuthority],
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
      throw new Error(
        "A requested lease pda account has not been initialized."
      );
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
      throw new Error(
        "A requested permission pda account has not been initialized."
      );
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
    for (const oracle of params.oracles) {
      remainingAccounts.push(oracle.tokenAccount);
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
    // const escrow = await spl.Token.getAssociatedTokenAddress(
    // spl.ASSOCIATED_TOKEN_PROGRAM_ID,
    // params.tokenMint,
    // this.program.programId,
    // leaseAccount.publicKey
    // );
    const escrow = await spl.Token.getAssociatedTokenAddress(
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      spl.TOKEN_PROGRAM_ID,
      params.tokenMint,
      leaseAccount.publicKey,
      true
    );
    const [feedPermissionAccount, feedPermissionBump] =
      PermissionAccount.fromSeed(
        this.program,
        params.queueAuthority,
        queueAccount.publicKey,
        this.publicKey
      );
    const [oraclePermissionAccount, oraclePermissionBump] =
      PermissionAccount.fromSeed(
        this.program,
        params.queueAuthority,
        queueAccount.publicKey,
        oracleAccount.publicKey
      );
    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );
    const digest = this.produceJobsHash(params.jobs).digest();
    let historyBuffer = aggregator.historyBuffer;
    if (historyBuffer.equals(PublicKey.default)) {
      historyBuffer = this.publicKey;
    }
    return this.program.transaction.aggregatorSaveResult(
      {
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
      },
      {
        accounts: {
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
        },
        remainingAccounts: remainingAccounts.map((pubkey: PublicKey) => {
          return { isSigner: false, isWritable: true, pubkey };
        }),
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
      280 + params.data.length + (params.variables?.join("")?.length ?? 0);
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
  PERMIT_VRF_REQUESTS = "permitVrfRequests",
}
export enum SwitchboardPermissionValue {
  PERMIT_ORACLE_HEARTBEAT = 1 << 0,
  PERMIT_ORACLE_QUEUE_USAGE = 1 << 1,
  PERMIT_VRF_REQUESTS = 1 << 2,
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
   * Check if a specific permission is enabled on this permission account
   */
  async isPermissionEnabled(
    permission: SwitchboardPermissionValue
  ): Promise<boolean> {
    const permissions = (await this.loadData()).permissions;
    return (permissions & (permission as number)) != 0;
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
      (
        await this.program.provider.connection.getAccountInfo(queue.dataBuffer)
      )?.data.slice(8) ?? Buffer.from("");
    const rowSize = 32;
    for (let i = 0; i < queue.size * rowSize; i += rowSize) {
      if (buffer.length - i < rowSize) {
        break;
      }
      const pubkeyBuf = buffer.slice(i, i + rowSize);
      const key = new PublicKey(pubkeyBuf);
      if (key === PublicKey.default) {
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
    params.queueSize = params.queueSize ?? 500;
    const queueSize = params.queueSize * 32 + 8;
    await program.rpc.oracleQueueInit(
      {
        name: (params.name ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 64),
        reward: params.reward ?? new anchor.BN(0),
        minStake: params.minStake ?? new anchor.BN(0),
        feedProbationPeriod: params.feedProbationPeriod ?? 0,
        oracleTimeout: params.oracleTimeout ?? 180,
        slashingEnabled: params.slashingEnabled ?? false,
        varianceToleranceMultiplier: SwitchboardDecimal.fromBig(
          new Big(params.varianceToleranceMultiplier ?? 2)
        ),
        authority: params.authority,
        consecutiveFeedFailureLimit:
          params.consecutiveFeedFailureLimit ?? new anchor.BN(1000),
        consecutiveOracleFailureLimit:
          params.consecutiveOracleFailureLimit ?? new anchor.BN(1000),
        minimumDelaySeconds: params.minimumDelaySeconds ?? 5,
        queueSize: params.queueSize,
        unpermissionedFeeds: params.unpermissionedFeeds ?? false,
      },
      {
        signers: [oracleQueueAccount, buffer],
        accounts: {
          oracleQueue: oracleQueueAccount.publicKey,
          authority: params.authority,
          buffer: buffer.publicKey,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: buffer.publicKey,
            space: queueSize,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                queueSize
              ),
            programId: program.programId,
          }),
        ],
      }
    );
    return new OracleQueueAccount({ program, keypair: oracleQueueAccount });
  }

  async setRewards(
    params: OracleQueueSetRewardsParams
  ): Promise<TransactionSignature> {
    const authority = params.authority ?? this.keypair;
    return await this.program.rpc.oracleQueueSetRewards(
      {
        rewards: params.rewards,
      },
      {
        signers: [authority],
        accounts: {
          queue: this.publicKey,
          authority: authority.publicKey,
        },
      }
    );
  }

  async setVrfSettings(
    params: OracleQueueSetVrfSettingsParams
  ): Promise<TransactionSignature> {
    const authority = params.authority ?? this.keypair;
    return await this.program.rpc.oracleQueueVrfConfig(
      {
        unpermissionedVrfEnabled: params.unpermissionedVrf,
      },
      {
        signers: [authority],
        accounts: {
          queue: this.publicKey,
          authority: authority.publicKey,
        },
      }
    );
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
    const escrow = await spl.Token.getAssociatedTokenAddress(
      switchTokenMint.associatedProgramId,
      switchTokenMint.programId,
      switchTokenMint.publicKey,
      leaseAccount.publicKey,
      true
    );

    try {
      await (switchTokenMint as any).createAssociatedTokenAccountInternal(
        leaseAccount.publicKey,
        escrow
      );
    } catch (e) {
      console.log(e);
    }
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

  async getBalance(): Promise<number> {
    // const [programStateAccount] = ProgramStateAccount.fromSeed(this.program);
    // const switchTokenMint = await programStateAccount.getTokenMint();
    // const mintData = await this.program.provider.connection.getAccountInfo(
    // switchTokenMint.publicKey
    // );
    // const mintInfo = spl.MintLayout.decode(mintData);
    // const decimals = spl.u8.fromBuffer(mintInfo.decimals).toNumber();
    const lease = await this.loadData();
    const escrowInfo = await this.program.provider.connection.getAccountInfo(
      lease.escrow
    );
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
  async estimatedLeaseTimeRemaining(): Promise<number> {
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
    const escrowInfo = await this.program.provider.connection.getAccountInfo(
      lease.escrow
    );
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
  async extend(params: LeaseExtendParams): Promise<TransactionSignature> {
    const program = this.program;
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
    return await program.rpc.leaseExtend(
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
  }

  /**
   * Withdraw funds from a LeaseAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   */
  async withdraw(params: LeaseWithdrawParams): Promise<TransactionSignature> {
    const program = this.program;
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
    return await program.rpc.leaseWithdraw(
      {
        amount: params.amount,
        stateBump,
        leaseBump,
      },
      {
        accounts: {
          lease: leaseAccount.publicKey,
          escrow,
          aggregator,
          queue,
          withdrawAuthority: params.withdrawAuthority.publicKey,
          withdrawAccount: params.withdrawWallet,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          programState: programStateAccount.publicKey,
        },
        signers: [params.withdrawAuthority],
      }
    );
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
      (
        await this.program.provider.connection.getAccountInfo(crank.dataBuffer)
      )?.data.slice(8) ?? Buffer.from("");
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
    params.maxRows = params.maxRows ?? 500;
    const crankSize = params.maxRows * 40 + 8;
    await program.rpc.crankInit(
      {
        name: (params.name ?? Buffer.from("")).slice(0, 32),
        metadata: (params.metadata ?? Buffer.from("")).slice(0, 64),
        crankSize: params.maxRows,
      },
      {
        signers: [crankAccount, buffer],
        accounts: {
          crank: crankAccount.publicKey,
          queue: params.queueAccount.publicKey,
          buffer: buffer.publicKey,
          systemProgram: SystemProgram.programId,
          payer: program.provider.wallet.publicKey,
        },
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: buffer.publicKey,
            space: crankSize,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                crankSize
              ),
            programId: program.programId,
          }),
        ],
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
      throw new Error(
        "A requested lease pda account has not been initialized."
      );
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
      throw new Error(
        "A requested permission pda account has not been initialized."
      );
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
    const failOpenOnAccountMismatch = params.failOpenOnMismatch ?? false;
    const next = params.readyPubkeys ?? (await this.peakNextReady(5));
    if (next.length === 0) {
      throw new Error("Crank is not ready to be turned.");
    }
    const remainingAccounts: Array<PublicKey> = [];
    const leaseBumpsMap: Map<string, number> = new Map();
    const permissionBumpsMap: Map<string, number> = new Map();
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
      const escrow = await spl.Token.getAssociatedTokenAddress(
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        spl.TOKEN_PROGRAM_ID,
        params.tokenMint,
        leaseAccount.publicKey,
        true
      );
      remainingAccounts.push(aggregatorAccount.publicKey);
      remainingAccounts.push(leaseAccount.publicKey);
      remainingAccounts.push(escrow);
      remainingAccounts.push(permissionAccount.publicKey);
      leaseBumpsMap.set(row.toBase58(), leaseBump);
      permissionBumpsMap.set(row.toBase58(), permissionBump);
    }
    remainingAccounts.sort((a: PublicKey, b: PublicKey) =>
      a.toBuffer().compare(b.toBuffer())
    );
    const crank = params.crank;
    const queue = params.queue;
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
    const payerKeypair = Keypair.fromSecretKey(
      (this.program.provider.wallet as any).payer.secretKey
    );
    // const promises: Array<Promise<TransactionSignature>> = [];
    return this.program.transaction.crankPop(
      {
        stateBump,
        leaseBumps: Buffer.from(leaseBumps),
        permissionBumps: Buffer.from(permissionBumps),
        nonce: params.nonce ?? null,
        failOpenOnAccountMismatch,
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
        signers: [payerKeypair],
      }
    );
  }

  /**
   * Pops an aggregator from the crank.
   * @param params
   * @return TransactionSignature
   */
  async pop(params: CrankPopParams): Promise<TransactionSignature> {
    const payerKeypair = Keypair.fromSecretKey(
      (this.program.provider.wallet as any).payer.secretKey
    );
    return await sendAndConfirmTransaction(
      this.program.provider.connection,
      await this.popTxn(params),
      [payerKeypair]
    );
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
  async peakNextReady(n?: number): Promise<Array<PublicKey>> {
    const now = Math.floor(+new Date() / 1000);
    let crank = await this.loadData();
    n = n ?? crank.pqSize;
    let items = crank.pqData
      .slice(0, crank.pqSize)
      .filter((row: CrankRow) => now >= row.nextTimestamp.toNumber())
      .sort((a: CrankRow, b: CrankRow) => a.nextTimestamp.sub(b.nextTimestamp))
      .slice(0, n)
      .map((item: CrankRow) => item.pubkey);
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
    console.log("creating oracle with txn batching");
    const payerKeypair = getProgramPayer(program);
    const authorityKeypair = params.oracleAuthority ?? payerKeypair;
    const size = program.account.oracleAccountData.size;
    const [programStateAccount, stateBump] =
      ProgramStateAccount.fromSeed(program);
    console.log("getting mint");
    const switchTokenMint = await programStateAccount.getTokenMint();

    const recentBlockhash = (
      await program.provider.connection.getRecentBlockhash()
    ).blockhash;

    const txn = new Transaction({
      feePayer: payerKeypair.publicKey,
      recentBlockhash,
    });

    const signers: Signer[] = [
      {
        publicKey: payerKeypair.publicKey,
        secretKey: payerKeypair.secretKey,
      },
      {
        publicKey: authorityKeypair.publicKey,
        secretKey: authorityKeypair.secretKey,
      },
    ];

    // Create oracle wallet
    const oracleWallet = anchor.web3.Keypair.generate();
    txn.add(
      SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: oracleWallet.publicKey,
        lamports: await spl.Token.getMinBalanceRentForExemptAccount(
          program.provider.connection
        ),
        space: spl.AccountLayout.span,
        programId: spl.TOKEN_PROGRAM_ID,
      })
    );
    txn.add(
      spl.Token.createInitAccountInstruction(
        spl.TOKEN_PROGRAM_ID,
        switchTokenMint.publicKey,
        oracleWallet.publicKey,
        programStateAccount.publicKey // owner
      )
    );
    signers.push({
      publicKey: oracleWallet.publicKey,
      secretKey: oracleWallet.secretKey,
    });

    const [oracleAccount, oracleBump] = OracleAccount.fromSeed(
      program,
      params.queueAccount,
      oracleWallet.publicKey
    );

    console.log("adding oracleInit instruction");
    const oracleSeed: Buffer[] = [
      Buffer.from("OracleAccountData"),
      params.queueAccount.publicKey.toBuffer(),
      oracleWallet.publicKey.toBuffer(),
      Buffer.from([oracleBump]),
      program.programId.toBuffer(),
      Buffer.from("ProgramDerivedAddress"),
    ];
    const seed = Buffer.concat(oracleSeed).toString();
    txn.add(
      // SystemProgram.allocate({
      //   accountPubkey: oracleAccount.publicKey,
      //   space: size,
      // })
      // SystemProgram.createAccount({
      //   fromPubkey: payerKeypair.publicKey,
      //   newAccountPubkey: oracleAccount.publicKey,
      //   lamports:
      //     await program.provider.connection.getMinimumBalanceForRentExemption(
      //       size
      //     ),
      //   space: size,
      //   programId: program.programId,
      // })
      SystemProgram.createAccountWithSeed({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: oracleAccount.publicKey,
        lamports:
          await program.provider.connection.getMinimumBalanceForRentExemption(
            size
          ),
        space: size,
        programId: program.programId,
        seed,
        basePubkey: payerKeypair.publicKey,
      })
    );
    txn.add(
      program.instruction.oracleInit(
        {
          name: (params.name ?? Buffer.from("")).slice(0, 32),
          metadata: (params.metadata ?? Buffer.from("")).slice(0, 128),
          stateBump,
          oracleBump,
        },
        {
          accounts: {
            oracle: oracleAccount.publicKey,
            oracleAuthority: authorityKeypair.publicKey,
            queue: params.queueAccount.publicKey,
            wallet: oracleWallet.publicKey,
            programState: programStateAccount.publicKey,
            systemProgram: SystemProgram.programId,
            payer: program.provider.wallet.publicKey,
          },
        }
      )
    );

    txn.sign(...signers);

    console.log("sending txn");
    const signature = await program.provider.connection.sendTransaction(
      txn,
      signers
    );
    console.log(signature);
    return new OracleAccount({ program, publicKey: oracleAccount.publicKey });
  }

  /**
   * Constructs OracleAccount from the static seed from which it was generated.
   * @return OracleAccount and PDA bump tuple.
   */
  static fromSeed(
    program: anchor.Program,
    queueAccount: OracleQueueAccount,
    wallet: PublicKey
  ): [OracleAccount, number] {
    const [oraclePubkey, oracleBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [
          Buffer.from("OracleAccountData"),
          queueAccount.publicKey.toBuffer(),
          wallet.toBuffer(),
        ],
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
      throw new Error(
        "A requested permission pda account has not been initialized."
      );
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

  /**
   * Withdraw stake and/or rewards from an OracleAccount.
   */
  async withdraw(params: OracleWithdrawParams): Promise<TransactionSignature> {
    const payerKeypair = Keypair.fromSecretKey(
      (this.program.provider.wallet as any).payer.secretKey
    );
    const oracle = await this.loadData();
    const queuePubkey = oracle.queuePubkey;
    const queueAccount = new OracleQueueAccount({
      program: this.program,
      publicKey: queuePubkey,
    });
    const queueAuthority = (await queueAccount.loadData()).authority;
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );
    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
      this.program,
      queueAuthority,
      queueAccount.publicKey,
      this.publicKey
    );

    return await this.program.rpc.oracleWithdraw(
      {
        permissionBump,
        stateBump,
        amount: params.amount,
      },
      {
        accounts: {
          oracle: this.publicKey,
          oracleAuthority: params.oracleAuthority.publicKey,
          tokenAccount: oracle.tokenAccount,
          withdrawAccount: params.withdrawAccount,
          oracleQueue: queueAccount.publicKey,
          permission: permissionAccount.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
          programState: stateAccount.publicKey,
          systemProgram: SystemProgram.programId,
          payer: this.program.provider.wallet.publicKey,
        },
        signers: [params.oracleAuthority],
      }
    );
  }

  async getBalance(): Promise<number> {
    const oracle = await this.loadData();
    const escrowInfo = await this.program.provider.connection.getAccountInfo(
      oracle.tokenAccount
    );
    const data = Buffer.from(escrowInfo.data);
    const accountInfo = spl.AccountLayout.decode(data);
    const balance = spl.u64.fromBuffer(accountInfo.amount).toNumber();
    return balance; // / mintInfo.decimals;
  }
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
export class VrfAccount {
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
      if (!params.publicKey.equals(params.keypair.publicKey)) {
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
   * Load and parse VrfAccount data based on the program IDL.
   * @return VrfAccount data parsed in accordance with the
   * Switchboard IDL.
   */
  async loadData(): Promise<any> {
    const vrf: any = await this.program.account.vrfAccountData.fetch(
      this.publicKey
    );
    vrf.ebuf = undefined;
    return vrf;
  }

  /**
   * Get the size of a VrfAccount on chain.
   * @return size.
   */
  size(): number {
    return this.program.account.vrfAccountData.size;
  }

  /**
   * Create and initialize the VrfAccount.
   * @param program Switchboard program representation holding connection and IDL.
   * @param params.
   * @return newly generated VrfAccount.
   */
  static async create(
    program: anchor.Program,
    params: VrfInitParams
  ): Promise<VrfAccount> {
    const [programStateAccount, stateBump] =
      ProgramStateAccount.fromSeed(program);
    const keypair = params.keypair;
    const size = program.account.vrfAccountData.size;
    const switchTokenMint = await programStateAccount.getTokenMint();
    const escrow = await spl.Token.getAssociatedTokenAddress(
      switchTokenMint.associatedProgramId,
      switchTokenMint.programId,
      switchTokenMint.publicKey,
      keypair.publicKey,
      true
    );

    try {
      await (switchTokenMint as any).createAssociatedTokenAccountInternal(
        keypair.publicKey,
        escrow
      );
    } catch (e) {
      console.log(e);
    }
    await switchTokenMint.setAuthority(
      escrow,
      programStateAccount.publicKey,
      "AccountOwner",
      keypair,
      []
    );
    await program.rpc.vrfInit(
      {
        stateBump,
        callback: params.callback,
      },
      {
        accounts: {
          vrf: keypair.publicKey,
          escrow,
          authority: params.authority ?? keypair.publicKey,
          oracleQueue: params.queue.publicKey,
          programState: programStateAccount.publicKey,
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        },
        instructions: [
          anchor.web3.SystemProgram.createAccount({
            fromPubkey: program.provider.wallet.publicKey,
            newAccountPubkey: keypair.publicKey,
            space: size,
            lamports:
              await program.provider.connection.getMinimumBalanceForRentExemption(
                size
              ),
            programId: program.programId,
          }),
        ],
        signers: [keypair],
      }
    );
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
  async requestRandomness(params: VrfRequestRandomnessParams) {
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
    const [stateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );
    const [permissionAccount, permissionBump] = PermissionAccount.fromSeed(
      this.program,
      queueAuthority,
      queueAccount.publicKey,
      this.publicKey
    );
    try {
      await permissionAccount.loadData();
    } catch (_) {
      throw new Error(
        "A requested permission pda account has not been initialized."
      );
    }
    const tokenProgram = spl.TOKEN_PROGRAM_ID;
    const recentBlockhashes = SYSVAR_RECENT_BLOCKHASHES_PUBKEY;
    await this.program.rpc.vrfRequestRandomness(
      {
        stateBump,
        permissionBump,
      },
      {
        accounts: {
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
        },
        signers: [params.authority, params.payerAuthority],
      }
    );
  }

  /**
   * Attempt the maximum amount of turns remaining on the vrf verify crank.
   * This will automatically call the vrf callback (if set) when completed.
   */
  async proveAndVerify(
    params: VrfProveAndVerifyParams
  ): Promise<Array<TransactionSignature>> {
    await this.prove(params);
    return await this.verify(params.oracleAccount, params.skipPreflight);
  }

  async prove(params: VrfProveParams): Promise<TransactionSignature> {
    const vrf = await this.loadData();
    let idx = -1;
    let producerKey = PublicKey.default;
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
    return await this.program.rpc.vrfProve(
      {
        proof: params.proof,
        idx,
      },
      {
        accounts: {
          vrf: this.publicKey,
          oracle: producerKey,
          randomnessProducer: params.oracleAuthority.publicKey,
        },
        signers: [params.oracleAuthority],
      }
    );
  }

  async verify(
    oracle: OracleAccount,
    skipPreflight: boolean = true,
    tryCount: number = 277
  ): Promise<Array<TransactionSignature>> {
    const txs: Array<any> = [];
    const vrf = await this.loadData();
    const idx = vrf.builders.find((builder) =>
      oracle.publicKey.equals(builder.producer)
    );
    if (idx === -1) {
      throw new Error("OracleNotFoundError");
    }
    let counter = 0;
    const remainingAccounts = vrf.callback.accounts.slice(
      0,
      vrf.callback.accountsLen
    );
    const [programStateAccount, stateBump] = ProgramStateAccount.fromSeed(
      this.program
    );
    const oracleData = await oracle.loadData();
    const oracleWallet = oracleData.tokenAccount;
    const oracleAuthority: PublicKey = oracleData.oracleAuthority;

    for (let i = 0; i < tryCount; ++i) {
      txs.push({
        tx: this.program.transaction.vrfVerify(
          {
            nonce: i,
            stateBump,
            idx,
          },
          {
            accounts: {
              vrf: this.publicKey,
              callbackPid: vrf.callback.programId,
              tokenProgram: spl.TOKEN_PROGRAM_ID,
              escrow: vrf.escrow,
              programState: programStateAccount.publicKey,
              oracle: oracle.publicKey,
              oracleAuthority,
              oracleWallet,
            },
            remainingAccounts,
          }
        ),
      });
    }
    return await sendAll(this.program.provider, txs, skipPreflight);
  }
}

async function sendAll(
  provider: anchor.Provider,
  reqs: Array<any>,
  skipPreflight: boolean
): Promise<Array<TransactionSignature>> {
  let res: Array<TransactionSignature> = [];
  try {
    const opts = provider.opts;
    const blockhash = await provider.connection.getRecentBlockhash(
      opts.preflightCommitment
    );

    let txs = reqs.map((r: any) => {
      let tx = r.tx;
      let signers = r.signers;

      if (signers === undefined) {
        signers = [];
      }

      tx.feePayer = provider.wallet.publicKey;
      tx.recentBlockhash = blockhash.blockhash;

      signers
        .filter((s: any): s is Signer => s !== undefined)
        .forEach((kp: any) => {
          tx.partialSign(kp);
        });

      return tx;
    });

    const signedTxs = await provider.wallet.signAllTransactions(txs);
    const promises = [];
    for (let k = 0; k < txs.length; k += 1) {
      const tx = signedTxs[k];
      const rawTx = tx.serialize();
      promises.push(
        provider.connection.sendRawTransaction(rawTx, {
          skipPreflight,
          maxRetries: 20,
        })
      );
    }
    return await Promise.all(promises);
  } catch (e) {
    console.log(e);
  }
  return res;
}

function getProgramPayer(program: anchor.Program): Keypair {
  return Keypair.fromSecretKey(
    (program.provider.wallet as any).payer.secretKey
  );
}
