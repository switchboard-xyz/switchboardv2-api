import * as sbv2 from "../sbv2";
import * as anchor from "@project-serum/anchor";
import { clusterApiUrl, Connection, PublicKey, Keypair } from "@solana/web3.js";
import { loadSwitchboardProgram } from "../sbv2";
import { getIdlAddress, getProgramDataAddress } from "./utils";
import fs from "fs";
import path from "path";
import chalk from "chalk";

export interface ISwitchboardTestEnvironment {
  programId: PublicKey;
  programDataAddress: PublicKey;
  idlAddress: PublicKey;
  programState: PublicKey;
  switchboardVault: PublicKey;
  switchboardMint: PublicKey;
  tokenWallet: PublicKey;
  queue: PublicKey;
  queueAuthority: PublicKey;
  queueBuffer: PublicKey;
  crank: PublicKey;
  crankBuffer: PublicKey;
  oracle: PublicKey;
  oracleAuthority: PublicKey;
  oracleEscrow: PublicKey;
  oraclePermissions: PublicKey;

  // allow a map of public keys to include in clone script
  additionalClonedAccounts?: Record<string, PublicKey>;
}

/** Contains all of the necessary devnet Switchboard accounts to clone to localnet */
export class SwitchboardTestEnvironment implements ISwitchboardTestEnvironment {
  programId: PublicKey;
  programDataAddress: PublicKey;
  idlAddress: PublicKey;
  programState: PublicKey;
  switchboardVault: PublicKey;
  switchboardMint: PublicKey;
  tokenWallet: PublicKey;
  queue: PublicKey;
  queueAuthority: PublicKey;
  queueBuffer: PublicKey;
  crank: PublicKey;
  crankBuffer: PublicKey;
  oracle: PublicKey;
  oracleAuthority: PublicKey;
  oracleEscrow: PublicKey;
  oraclePermissions: PublicKey;
  additionalClonedAccounts?: Record<string, PublicKey>;

  constructor(ctx: ISwitchboardTestEnvironment) {
    this.programId = ctx.programId;
    this.programDataAddress = ctx.programDataAddress;
    this.idlAddress = ctx.idlAddress;
    this.programState = ctx.programState;
    this.switchboardVault = ctx.switchboardVault;
    this.switchboardMint = ctx.switchboardMint;
    this.tokenWallet = ctx.tokenWallet;
    this.queue = ctx.queue;
    this.queueAuthority = ctx.queueAuthority;
    this.queueBuffer = ctx.queueBuffer;
    this.crank = ctx.crank;
    this.crankBuffer = ctx.crankBuffer;
    this.oracle = ctx.oracle;
    this.oracleAuthority = ctx.oracleAuthority;
    this.oracleEscrow = ctx.oracleEscrow;
    this.oraclePermissions = ctx.oraclePermissions;
    this.additionalClonedAccounts = ctx.additionalClonedAccounts;
  }

  private getAccountCloneString(): string {
    const accounts: string[] = Object.entries(this).map(
      (field: any[]) => {
        const [key, val] = field;
        // iterate over additionalClonedAccounts and collect pubkeys
        if (key === "additionalClonedAccounts" && val) {
          const additionalPubkeys = Object.values(
            this.additionalClonedAccounts
          );
          const cloneStrings = additionalPubkeys.map(
            (pubkey) => `--clone ${pubkey.toBase58()}`
          );
          return cloneStrings.join(" ");
        }

        return `--clone ${(val as PublicKey).toBase58()}`;
      }
    );

    return accounts.join(" ");
  }

  public toJSON(): ISwitchboardTestEnvironment {
    return {
      programId: this.programId,
      programDataAddress: this.programDataAddress,
      idlAddress: this.idlAddress,
      programState: this.programState,
      switchboardVault: this.switchboardVault,
      switchboardMint: this.switchboardMint,
      tokenWallet: this.tokenWallet,
      queue: this.queue,
      queueAuthority: this.queueAuthority,
      queueBuffer: this.queueBuffer,
      crank: this.crank,
      crankBuffer: this.crankBuffer,
      oracle: this.oracle,
      oracleAuthority: this.oracleAuthority,
      oracleEscrow: this.oracleEscrow,
      oraclePermissions: this.oraclePermissions,
      additionalClonedAccounts: this.additionalClonedAccounts,
    };
  }

  /** Write switchboard test environment to filesystem */
  public writeAll(payerKeypairPath: string, filePath: string): void {
    this.writeEnv(filePath);
    this.writeJSON(filePath);
    this.writeScripts(payerKeypairPath, filePath);
  }

  /** Write the env file to filesystem */
  public writeEnv(filePath: string): void {
    const ENV_FILE_PATH = path.join(filePath, "switchboard.env");
    let fileStr = "";
    fileStr += `SWITCHBOARD_PROGRAM_ID="${this.programId.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_PROGRAM_DATA_ADDRESS="${this.programDataAddress.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_IDL_ADDRESS="${this.idlAddress.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_PROGRAM_STATE="${this.programState.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_VAULT="${this.switchboardVault.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_MINT="${this.switchboardMint.toBase58()}"\n`;
    fileStr += `TOKEN_WALLET="${this.tokenWallet.toBase58()}"\n`;
    fileStr += `ORACLE_QUEUE="${this.queue.toBase58()}"\n`;
    fileStr += `ORACLE_QUEUE_AUTHORITY="${this.queueAuthority.toBase58()}"\n`;
    fileStr += `ORACLE_QUEUE_BUFFER="${this.queueBuffer.toBase58()}"\n`;
    fileStr += `CRANK="${this.crank.toBase58()}"\n`;
    fileStr += `CRANK_BUFFER="${this.crankBuffer.toBase58()}"\n`;
    fileStr += `ORACLE="${this.oracle.toBase58()}"\n`;
    fileStr += `ORACLE_AUTHORITY="${this.oracleAuthority.toBase58()}"\n`;
    fileStr += `ORACLE_ESCROW="${this.oracleEscrow.toBase58()}"\n`;
    fileStr += `ORACLE_PERMISSIONS="${this.oraclePermissions.toBase58()}"\n`;
    fileStr += `SWITCHBOARD_ACCOUNTS="${this.getAccountCloneString()}"\n`;
    // TODO: Write additionalClonedAccounts to env file
    fs.writeFileSync(ENV_FILE_PATH, fileStr);
    console.log(
      `${chalk.green("Env File saved to:")} ${ENV_FILE_PATH.replace(
        process.cwd(),
        "."
      )}`
    );
  }

  public writeJSON(filePath: string): void {
    const JSON_FILE_PATH = path.join(filePath, "switchboard.json");
    fs.writeFileSync(
      JSON_FILE_PATH,
      JSON.stringify(
        this.toJSON(),
        (key, value) => {
          if (value instanceof PublicKey) {
            return value.toBase58();
          }
          return value;
        },
        2
      )
    );
  }

  public writeScripts(payerKeypairPath: string, filePath: string): void {
    const LOCAL_VALIDATOR_SCRIPT = path.join(
      filePath,
      "start-local-validator.sh"
    );
    // create bash script to startup local validator with appropriate accounts cloned
    const baseValidatorCommand = `solana-test-validator -r --ledger .anchor/test-ledger --mint ${this.oracleAuthority.toBase58()} --deactivate-feature 5ekBxc8itEnPv4NzGJtr8BVVQLNMQuLMNQQj7pHoLNZ9 --bind-address 0.0.0.0 --url ${clusterApiUrl(
      "devnet"
    )} --rpc-port 8899 `;
    const cloneAccountsString = this.getAccountCloneString();
    const startValidatorCommand = `${baseValidatorCommand} ${cloneAccountsString}`;
    fs.writeFileSync(
      LOCAL_VALIDATOR_SCRIPT,
      `#!/bin/bash\n\n${startValidatorCommand}`
    );
    console.log(
      `${chalk.green("Bash script saved to:")} ${LOCAL_VALIDATOR_SCRIPT.replace(
        process.cwd(),
        "."
      )}`
    );

    // create bash script to start local oracle
    const ORACLE_SCRIPT = path.join(filePath, "start-oracle.sh");
    const startOracleCommand = `ORACLE=${this.oracle.toBase58()} PAYER_KEYPAIR=${payerKeypairPath} docker-compose up`;
    fs.writeFileSync(ORACLE_SCRIPT, `#!/bin/bash\n\n${startOracleCommand}`);
    console.log(
      `${chalk.green("Bash script saved to:")} ${ORACLE_SCRIPT.replace(
        process.cwd(),
        "."
      )}`
    );
  }

  /** Build a devnet environment to later clone to localnet */
  static async create(
    payerKeypair: Keypair,
    additionalClonedAccounts?: Record<string, PublicKey>
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
        name: Buffer.from("My Test Queue"),
        authority: payerKeypair.publicKey, // Approve new participants
        minStake: new anchor.BN(0), // Oracle minStake to heartbeat
        reward: new anchor.BN(0), // Oracle rewards per request (non-VRF)
        queueSize: 10, // Number of active oracles a queue can support
        unpermissionedFeeds: true, // Whether feeds need PERMIT_ORACLE_QUEUE_USAGE permissions
        unpermissionedVrf: true, // Whether VRF accounts need PERMIT_VRF_REQUESTS permissions
        mint: programState.tokenMint,
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

    const ctx: ISwitchboardTestEnvironment = {
      programId: switchboardProgram.programId,
      programDataAddress,
      idlAddress,
      programState: switchboardProgramState.publicKey,
      switchboardVault: programState.tokenVault,
      switchboardMint: switchboardMint.publicKey,
      tokenWallet: payerSwitchboardWallet,
      queue: queueAccount.publicKey,
      queueAuthority: queue.authority,
      queueBuffer: queue.dataBuffer,
      crank: crankAccount.publicKey,
      crankBuffer: crank.dataBuffer,
      oracle: oracleAccount.publicKey,
      oracleAuthority: oracle.oracleAuthority,
      oracleEscrow: oracle.tokenAccount,
      oraclePermissions: oraclePermissionAccount.publicKey,
      additionalClonedAccounts,
    };

    return new SwitchboardTestEnvironment(ctx);
  }
}
