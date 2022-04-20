import { PublicKey } from "@solana/web3.js";
export declare const DEFAULT_PUBKEY: PublicKey;
export declare const sleep: (ms: number) => Promise<any>;
export declare function promiseWithTimeout<T>(ms: number, promise: Promise<T>, timeoutError?: Error): Promise<T>;
export declare const getProgramDataAddress: (programId: PublicKey) => PublicKey;
export declare const getIdlAddress: (programId: PublicKey) => Promise<PublicKey>;
