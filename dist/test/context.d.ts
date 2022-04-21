import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import * as sbv2 from "../sbv2";
import { PublicKey } from "@solana/web3.js";
export interface ISwitchboardTestContext {
    program: anchor.Program;
    mint: spl.Token;
    tokenWallet: PublicKey;
    queue: sbv2.OracleQueueAccount;
    oracle: sbv2.OracleAccount;
}
export declare class SwitchboardTestContext implements ISwitchboardTestContext {
    program: anchor.Program;
    mint: spl.Token;
    tokenWallet: PublicKey;
    queue: sbv2.OracleQueueAccount;
    oracle: sbv2.OracleAccount;
    constructor(ctx: ISwitchboardTestContext);
    private static createSwitchboardWallet;
    /** Load SwitchboardTestContext from an env file containing $SWITCHBOARD_PROGRAM_ID, $ORACLE_QUEUE, $AGGREGATOR, $ORACLE
     * @param provider anchor Provider containing connection and payer Keypair
     * @param filePath filesystem path to env file
     */
    static loadFromEnv(provider: anchor.Provider, filePath: string): Promise<SwitchboardTestContext>;
    /** Create a static data feed that resolves to an expected value */
    createStaticFeed(value: number): Promise<sbv2.AggregatorAccount>;
    /** Update a feed to a single job that resolves to a new expected value
     * @param aggregatorAccount the aggregator to change a job definition for
     * @param value the new expected value
     * @param timeout how long to wait for the oracle to update the aggregator's latestRound result
     */
    updateStaticFeed(aggregatorAccount: sbv2.AggregatorAccount, value: number, timeout?: number): Promise<void>;
}
