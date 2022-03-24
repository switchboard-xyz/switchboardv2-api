import { clusterApiUrl, Connection, PublicKey, Keypair } from "@solana/web3.js";
import { loadSwitchboardProgram } from "../sbv2";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";
import * as sbv2 from "../sbv2";
import * as anchor from "@project-serum/anchor";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import { getIdlAddress, getProgramDataAddress } from "./utils";
import fs from "fs";

export interface ISwitchboardTestEnvironment {
  programId: PublicKey;
  programDataAddress: PublicKey;
  idlAddress: PublicKey;
  programState: PublicKey;
  switchboardVault: PublicKey;
  usdcMint: PublicKey;
  switchboardMint: PublicKey;
  authorWallet: PublicKey;
  queue: PublicKey;
  queueAuthority: PublicKey;
  queueBuffer: PublicKey;
  crank: PublicKey;
  crankBuffer: PublicKey;
  oracle: PublicKey;
  oracleEscrow: PublicKey;
  oraclePermissions: PublicKey;
  aggregator: PublicKey;
  aggregatorPermissions: PublicKey;
  aggregatorJob1: PublicKey;
  aggregatorLease: PublicKey;
  leaseEscrow: PublicKey;
}

export class SwitchboardTestEnvironment implements ISwitchboardTestEnvironment {
  programId: PublicKey;
  programDataAddress: PublicKey;
  idlAddress: PublicKey;
  programState: PublicKey;
  switchboardVault: PublicKey;
  usdcMint: PublicKey;
  switchboardMint: PublicKey;
  authorWallet: PublicKey;
  queue: PublicKey;
  queueAuthority: PublicKey;
  queueBuffer: PublicKey;
  crank: PublicKey;
  crankBuffer: PublicKey;
  oracle: PublicKey;
  oracleEscrow: PublicKey;
  oraclePermissions: PublicKey;
  aggregator: PublicKey;
  aggregatorPermissions: PublicKey;
  aggregatorJob1: PublicKey;
  aggregatorLease: PublicKey;
  leaseEscrow: PublicKey;

  constructor(ctx: ISwitchboardTestEnvironment) {
    this.programId = ctx.programId;
    this.programDataAddress = ctx.programDataAddress;
    this.idlAddress = ctx.idlAddress;
    this.programState = ctx.programState;
    this.switchboardVault = ctx.switchboardVault;
    this.usdcMint = ctx.usdcMint;
    this.switchboardMint = ctx.switchboardMint;
    this.authorWallet = ctx.authorWallet;
    this.queue = ctx.queue;
    this.queueAuthority = ctx.queueAuthority;
    this.queueBuffer = ctx.queueBuffer;
    this.crank = ctx.crank;
    this.crankBuffer = ctx.crankBuffer;
    this.oracle = ctx.oracle;
    this.oracleEscrow = ctx.oracleEscrow;
    this.oraclePermissions = ctx.oraclePermissions;
    this.aggregator = ctx.aggregator;
    this.aggregatorPermissions = ctx.aggregatorPermissions;
    this.aggregatorJob1 = ctx.aggregatorJob1;
    this.aggregatorLease = ctx.aggregatorLease;
    this.leaseEscrow = ctx.leaseEscrow;
  }

  private getAccountCloneString(): string {
    const accounts: string[] = Object.keys(this).map(
      (key) => `--clone ${(this[key] as PublicKey).toBase58()}`
    );
    return accounts.join(" ");
  }

  public writeENV(filePath: string): void {
    let fileStr = "";
    fileStr += `SWITCHBOARD_PROGRAM_ID="${this.programId.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_PROGRAM_DATA_ADDRESS="${this.programDataAddress.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_IDL_ADDRESS="${this.idlAddress.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_PROGRAM_STATE="${this.programState.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_VAULT="${this.switchboardVault.toBase58()}"\n`;
    fileStr += `USDC_MINT="${this.usdcMint.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_MINT="${this.switchboardMint.toBase58()}"\n`;
    fileStr += `AUTHOR_WALLET="${this.authorWallet.toBase58()}"\n`;
    fileStr += `ORACLE_QUEUE="${this.queue.toBase58()}"\n`;
    fileStr += `ORACLE_QUEUE_AUTHORITY="${this.queueAuthority.toBase58()}"\n`;
    fileStr += `ORACLE_QUEUE_BUFFER="${this.queueBuffer.toBase58()}"\n`;
    fileStr += `CRANK="${this.crank.toBase58()}"\n`;
    fileStr += `CRANK_BUFFER="${this.crankBuffer.toBase58()}"\n`;
    fileStr += `ORACLE="${this.oracle.toBase58()}"\n`;
    fileStr += `ORACLE_ESCROW="${this.oracleEscrow.toBase58()}"\n`;
    fileStr += `ORACLE_PERMISSIONS="${this.oraclePermissions.toBase58()}"\n`;
    fileStr += `AGGREGATOR="${this.aggregator.toBase58()}"\n`;
    fileStr += `AGGREGATOR_PERMISSIONS="${this.aggregatorPermissions.toBase58()}"\n`;
    fileStr += `AGGREGATOR_JOB_1="${this.aggregatorJob1.toBase58()}"\n`;
    fileStr += `AGGREGATOR_LEASE="${this.aggregatorLease.toBase58()}"\n`;
    fileStr += `AGGREGATOR_LEASE_ESCROW="${this.leaseEscrow.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_ACCOUNTS="${this.getAccountCloneString()}"\n`;
    fs.writeFileSync(filePath, fileStr);
  }

  public writeJSON(filePath: string): void {
    fs.writeFileSync(filePath, JSON.stringify(this, undefined, 2));
  }

  /** Build a devnet environment to later clone to localnet */
  static async create(
    payerKeypair: Keypair
  ): Promise<SwitchboardTestEnvironment> {
    const connection = new Connection(clusterApiUrl("devnet"), {
      commitment: "confirmed",
    });

    const switchboardProgram = await loadSwitchboardProgram(
      "devnet",
      connection,
      payerKeypair,
      { commitment: "confirmed" }
    );
    const programDataAddress = getProgramDataAddress(
      switchboardProgram.programId
    );
    const idlAddress = await getIdlAddress(switchboardProgram.programId);

    const [switchboardProgramState] =
      sbv2.ProgramStateAccount.fromSeed(switchboardProgram);
    const switchboardMint = await switchboardProgramState.getTokenMint();
    const payerSwitchboardWallet = (
      await switchboardMint.getOrCreateAssociatedAccountInfo(
        payerKeypair.publicKey
      )
    ).address;
    const programState = await switchboardProgramState.loadData();

    // create queue with unpermissioned VRF accounts enabled
    const queueAccount = await sbv2.OracleQueueAccount.create(
      switchboardProgram,
      {
        name: Buffer.from("My Queue"),
        authority: payerKeypair.publicKey, // Approve new participants
        minStake: new anchor.BN(0), // Oracle minStake to heartbeat
        reward: new anchor.BN(0), // Oracle rewards per request (non-VRF)
        queueSize: 10, // Number of active oracles a queue can support
        unpermissionedFeeds: true, // Whether feeds need PERMIT_ORACLE_QUEUE_USAGE permissions
        unpermissionedVrf: true, // Whether VRF accounts need PERMIT_VRF_REQUESTS permissions
      }
    );
    await queueAccount.setVrfSettings({
      authority: payerKeypair,
      unpermissionedVrf: true,
    });
    const queue = await queueAccount.loadData();

    // create a crank for the queue
    const crankAccount = await sbv2.CrankAccount.create(switchboardProgram, {
      name: Buffer.from("My Crank"),
      maxRows: 100,
      queueAccount,
    });
    const crank = await crankAccount.loadData();

    // create oracle to run locally
    const oracleAccount = await sbv2.OracleAccount.create(switchboardProgram, {
      name: Buffer.from("My Oracle"),
      oracleAuthority: payerKeypair,
      queueAccount,
    });
    const oracle = await oracleAccount.loadData();

    // grant oracle heartbeat permissions
    const oraclePermissionAccount = await sbv2.PermissionAccount.create(
      switchboardProgram,
      {
        authority: queue.authority,
        granter: queueAccount.publicKey,
        grantee: oracleAccount.publicKey,
      }
    );
    await oraclePermissionAccount.set({
      authority: payerKeypair,
      enable: true,
      permission: sbv2.SwitchboardPermission.PERMIT_ORACLE_HEARTBEAT,
    });
    const oraclePermissions = await oraclePermissionAccount.loadData();

    // create aggregator and add a single job to it
    const aggregatorAccount = await sbv2.AggregatorAccount.create(
      switchboardProgram,
      {
        name: Buffer.from("My SOL/USD Feed"),
        authority: payerKeypair.publicKey, // can make account changes
        authorWallet: payerSwitchboardWallet, // token wallet for payouts
        batchSize: 1, // Number of oracles assigned to an update request
        minRequiredJobResults: 1, // Min job results before a value is accepted
        minRequiredOracleResults: 1, // Min oracles that must respond before a value is accepted
        minUpdateDelaySeconds: 5, // Minimum time between update request
        queueAccount,
      }
    );
    const aggregator = await aggregatorAccount.loadData();
    const jobAccount1 = await sbv2.JobAccount.create(switchboardProgram, {
      name: Buffer.from("FtxUS SOL/USD"),
      authorWallet: payerSwitchboardWallet, // token wallet for payouts
      data: Buffer.from(
        OracleJob.encodeDelimited(
          OracleJob.create({
            tasks: [
              OracleJob.Task.create({
                httpTask: OracleJob.HttpTask.create({
                  url: `https://ftx.us/api/markets/SOL_USD`,
                }),
              }),
              OracleJob.Task.create({
                jsonParseTask: OracleJob.JsonParseTask.create({
                  path: "$.result.price",
                }),
              }),
            ],
          })
        ).finish()
      ),
    });
    await aggregatorAccount.addJob(jobAccount1, payerKeypair);

    // grant aggregator queue permissions
    const aggregatorPermissionAccount = await sbv2.PermissionAccount.create(
      switchboardProgram,
      {
        authority: queue.authority,
        granter: queueAccount.publicKey,
        grantee: aggregatorAccount.publicKey,
      }
    );
    await aggregatorPermissionAccount.set({
      authority: payerKeypair,
      enable: true,
      permission: sbv2.SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE,
    });
    const aggregatorPermissions = await aggregatorPermissionAccount.loadData();

    // create aggregator lease Account
    const leaseAccount = await sbv2.LeaseAccount.create(switchboardProgram, {
      loadAmount: new anchor.BN(0),
      funder: payerSwitchboardWallet,
      funderAuthority: payerKeypair,
      oracleQueueAccount: queueAccount,
      aggregatorAccount,
    });
    const lease = await leaseAccount.loadData();

    const ctx: ISwitchboardTestEnvironment = {
      programId: switchboardProgram.programId,
      programDataAddress,
      idlAddress,
      programState: switchboardProgramState.publicKey,
      switchboardVault: programState.tokenVault,
      usdcMint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
      switchboardMint: switchboardMint.publicKey,
      authorWallet: payerSwitchboardWallet,
      queue: queueAccount.publicKey,
      queueAuthority: queue.authority,
      queueBuffer: queue.dataBuffer,
      crank: crankAccount.publicKey,
      crankBuffer: crank.dataBuffer,
      oracle: oracleAccount.publicKey,
      oracleEscrow: oracle.tokenAccount,
      oraclePermissions: oraclePermissionAccount.publicKey,
      aggregator: aggregatorAccount.publicKey,
      aggregatorPermissions: aggregatorPermissionAccount.publicKey,
      aggregatorJob1: jobAccount1.publicKey,
      aggregatorLease: leaseAccount.publicKey,
      leaseEscrow: lease.escrow,
    };

    return new SwitchboardTestEnvironment(ctx);
  }
}
