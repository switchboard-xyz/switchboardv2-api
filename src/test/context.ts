import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import * as sbv2 from "../sbv2";
import { clusterApiUrl, Connection, PublicKey, Keypair } from "@solana/web3.js";
import { loadSwitchboardProgram } from "../sbv2";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import { OracleJob } from "@switchboard-xyz/switchboard-api";

export interface ISwitchboardTestContext {
  program: anchor.Program;
  mint: spl.Token;
  tokenWallet: PublicKey;
  queue: sbv2.OracleQueueAccount;
  oracle: sbv2.OracleAccount;
  aggregator: sbv2.AggregatorAccount;
}

export class SwitchboardTestContext implements ISwitchboardTestContext {
  program: anchor.Program;
  mint: spl.Token;
  tokenWallet: PublicKey;
  queue: sbv2.OracleQueueAccount;
  oracle: sbv2.OracleAccount;
  aggregator: sbv2.AggregatorAccount;

  constructor(ctx: ISwitchboardTestContext) {
    this.program = ctx.program;
    this.mint = ctx.mint;
    this.tokenWallet = ctx.tokenWallet;
    this.queue = ctx.queue;
    this.oracle = ctx.oracle;
    this.aggregator = ctx.aggregator;
  }

  async loadFromENV(
    provider: anchor.Provider,
    filePath: string
  ): Promise<SwitchboardTestContext> {
    require("dotenv").config({ path: filePath });
    if (!process.env.SWITCHBOARD_PROGRAM_ID) {
      throw new Error(`your env file must have $SWITCHBOARD_PROGRAM_ID set`);
    }
    const SWITCHBOARD_PID = new PublicKey(process.env.SWITCHBOARD_PROGRAM_ID);
    const switchboardIdl = await anchor.Program.fetchIdl(
      SWITCHBOARD_PID,
      provider
    );
    if (!switchboardIdl) {
      throw new Error(`failed to load Switchboard IDL`);
    }
    const switchboardProgram = new anchor.Program(
      switchboardIdl,
      SWITCHBOARD_PID,
      provider
    );

    if (!process.env.ORACLE_QUEUE) {
      throw new Error(`your env file must have $ORACLE_QUEUE set`);
    }
    const SWITCHBOARD_QUEUE = new PublicKey(process.env.ORACLE_QUEUE);
    const queue = new sbv2.OracleQueueAccount({
      program: switchboardProgram,
      publicKey: SWITCHBOARD_QUEUE,
    });

    if (!process.env.AGGREGATOR) {
      throw new Error(`your env file must have $AGGREGATOR set`);
    }
    const SWITCHBOARD_AGGREGATOR = new PublicKey(process.env.AGGREGATOR);
    const aggregator = new sbv2.AggregatorAccount({
      program: switchboardProgram,
      publicKey: SWITCHBOARD_AGGREGATOR,
    });

    // TODO: Check oracle is heartbeating when context starts
    if (!process.env.ORACLE) {
      throw new Error(`your env file must have $ORACLE set`);
    }
    const SWITCHBOARD_ORACLE = new PublicKey(process.env.ORACLE);
    const oracle = new sbv2.OracleAccount({
      program: switchboardProgram,
      publicKey: SWITCHBOARD_ORACLE,
    });

    const [switchboardProgramState] =
      sbv2.ProgramStateAccount.fromSeed(switchboardProgram);
    const switchboardMint = await switchboardProgramState.getTokenMint();

    const tokenWallet = await switchboardMint.getOrCreateAssociatedAccountInfo(
      provider.wallet.publicKey
    );

    const context: ISwitchboardTestContext = {
      program: switchboardProgram,
      mint: switchboardMint,
      tokenWallet: tokenWallet.address,
      queue: queue,
      aggregator,
      oracle,
    };

    return new SwitchboardTestContext(context);
  }
}
