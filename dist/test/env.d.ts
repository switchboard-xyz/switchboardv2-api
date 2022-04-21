import { PublicKey, Keypair } from "@solana/web3.js";
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
    additionalClonedAccounts?: Record<string, PublicKey>;
}
/** Contains all of the necessary devnet Switchboard accounts to clone to localnet */
export declare class SwitchboardTestEnvironment implements ISwitchboardTestEnvironment {
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
    constructor(ctx: ISwitchboardTestEnvironment);
    private getAccountCloneString;
    toJSON(): ISwitchboardTestEnvironment;
    /** Write switchboard test environment to filesystem */
    writeAll(payerKeypairPath: string, filePath: string): void;
    /** Write the env file to filesystem */
    writeEnv(filePath: string): void;
    writeJSON(filePath: string): void;
    writeScripts(payerKeypairPath: string, filePath: string): void;
    /** Build a devnet environment to later clone to localnet */
    static create(payerKeypair: Keypair, additionalClonedAccounts?: Record<string, PublicKey>): Promise<SwitchboardTestEnvironment>;
}
