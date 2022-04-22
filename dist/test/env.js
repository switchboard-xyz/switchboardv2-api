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
exports.SwitchboardTestEnvironment = void 0;
const sbv2 = __importStar(require("../sbv2"));
const anchor = __importStar(require("@project-serum/anchor"));
const web3_js_1 = require("@solana/web3.js");
const sbv2_1 = require("../sbv2");
const utils_1 = require("./utils");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
/** Contains all of the necessary devnet Switchboard accounts to clone to localnet */
class SwitchboardTestEnvironment {
    constructor(ctx) {
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
    getAccountCloneString() {
        const accounts = Object.keys(this).map((key) => {
            // iterate over additionalClonedAccounts and collect pubkeys
            if (key === "additionalClonedAccounts" && this[key]) {
                const additionalPubkeys = Object.values(this.additionalClonedAccounts);
                const cloneStrings = additionalPubkeys.map((pubkey) => `--clone ${pubkey.toBase58()}`);
                return cloneStrings.join(" ");
            }
            return `--clone ${this[key].toBase58()}`;
        });
        return accounts.join(" ");
    }
    toJSON() {
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
    writeAll(payerKeypairPath, filePath) {
        this.writeEnv(filePath);
        this.writeJSON(filePath);
        this.writeScripts(payerKeypairPath, filePath);
    }
    /** Write the env file to filesystem */
    writeEnv(filePath) {
        const ENV_FILE_PATH = path_1.default.join(filePath, "switchboard.env");
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
        fs_1.default.writeFileSync(ENV_FILE_PATH, fileStr);
        console.log(`${chalk_1.default.green("Env File saved to:")} ${ENV_FILE_PATH.replace(process.cwd(), ".")}`);
    }
    writeJSON(filePath) {
        const JSON_FILE_PATH = path_1.default.join(filePath, "switchboard.json");
        fs_1.default.writeFileSync(JSON_FILE_PATH, JSON.stringify(this.toJSON(), (key, value) => {
            if (value instanceof web3_js_1.PublicKey) {
                return value.toBase58();
            }
            return value;
        }, 2));
    }
    writeScripts(payerKeypairPath, filePath) {
        const LOCAL_VALIDATOR_SCRIPT = path_1.default.join(filePath, "start-local-validator.sh");
        // create bash script to startup local validator with appropriate accounts cloned
        const baseValidatorCommand = `solana-test-validator -r --ledger .anchor/test-ledger --mint ${this.oracleAuthority.toBase58()} --deactivate-feature 5ekBxc8itEnPv4NzGJtr8BVVQLNMQuLMNQQj7pHoLNZ9 --bind-address 0.0.0.0 --url ${web3_js_1.clusterApiUrl("devnet")} --rpc-port 8899 `;
        const cloneAccountsString = this.getAccountCloneString();
        const startValidatorCommand = `${baseValidatorCommand} ${cloneAccountsString}`;
        fs_1.default.writeFileSync(LOCAL_VALIDATOR_SCRIPT, `#!/bin/bash\n\n${startValidatorCommand}`);
        console.log(`${chalk_1.default.green("Bash script saved to:")} ${LOCAL_VALIDATOR_SCRIPT.replace(process.cwd(), ".")}`);
        // create bash script to start local oracle
        const ORACLE_SCRIPT = path_1.default.join(filePath, "start-oracle.sh");
        const startOracleCommand = `ORACLE=${this.oracle.toBase58()} PAYER_KEYPAIR=${payerKeypairPath} docker-compose up`;
        fs_1.default.writeFileSync(ORACLE_SCRIPT, `#!/bin/bash\n\n${startOracleCommand}`);
        console.log(`${chalk_1.default.green("Bash script saved to:")} ${ORACLE_SCRIPT.replace(process.cwd(), ".")}`);
    }
    /** Build a devnet environment to later clone to localnet */
    static async create(payerKeypair, additionalClonedAccounts) {
        const connection = new web3_js_1.Connection(web3_js_1.clusterApiUrl("devnet"), {
            commitment: "confirmed",
        });
        const switchboardProgram = await sbv2_1.loadSwitchboardProgram("devnet", connection, payerKeypair, { commitment: "confirmed" });
        const programDataAddress = utils_1.getProgramDataAddress(switchboardProgram.programId);
        const idlAddress = await utils_1.getIdlAddress(switchboardProgram.programId);
        const [switchboardProgramState] = sbv2.ProgramStateAccount.fromSeed(switchboardProgram);
        const switchboardMint = await switchboardProgramState.getTokenMint();
        const payerSwitchboardWallet = (await switchboardMint.getOrCreateAssociatedAccountInfo(payerKeypair.publicKey)).address;
        const programState = await switchboardProgramState.loadData();
        // create queue with unpermissioned VRF accounts enabled
        const queueAccount = await sbv2.OracleQueueAccount.create(switchboardProgram, {
            name: Buffer.from("My Test Queue"),
            authority: payerKeypair.publicKey,
            minStake: new anchor.BN(0),
            reward: new anchor.BN(0),
            queueSize: 10,
            unpermissionedFeeds: true,
            unpermissionedVrf: true,
            mint: programState.tokenMint,
        });
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
        const oraclePermissionAccount = await sbv2.PermissionAccount.create(switchboardProgram, {
            authority: queue.authority,
            granter: queueAccount.publicKey,
            grantee: oracleAccount.publicKey,
        });
        await oraclePermissionAccount.set({
            authority: payerKeypair,
            enable: true,
            permission: sbv2.SwitchboardPermission.PERMIT_ORACLE_HEARTBEAT,
        });
        const ctx = {
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
exports.SwitchboardTestEnvironment = SwitchboardTestEnvironment;
//# sourceMappingURL=env.js.map