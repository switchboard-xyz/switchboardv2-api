/* eslint-disable unicorn/no-await-expression-member */
import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import * as sbv2 from "../sbv2";
import Big from "big.js";
import { findProgramAddressSync } from "@project-serum/anchor/dist/cjs/utils/pubkey";

export const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");

export const sleep = (ms: number): Promise<any> =>
  new Promise((s) => setTimeout(s, ms));

export async function promiseWithTimeout<T>(
  ms: number,
  promise: Promise<T>,
  timeoutError = new Error("timeoutError")
): Promise<T> {
  // create a promise that rejects in milliseconds
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(timeoutError);
    }, ms);
  });

  return Promise.race<T>([promise, timeout]);
}

export const createsStaticFeed = async (
  oracleQueue: sbv2.OracleQueueAccount,
  value: number,
  payoutWallet: PublicKey
) => {
  const queue = await oracleQueue.loadData();
  const payerKeypair = sbv2.getPayer(oracleQueue.program);

  // create aggregator
  const aggregatorAccount = await sbv2.AggregatorAccount.create(
    oracleQueue.program,
    {
      batchSize: 1,
      minRequiredJobResults: 1,
      minRequiredOracleResults: 1,
      minUpdateDelaySeconds: 5,
      queueAccount: oracleQueue,
      authorWallet: payoutWallet,
    }
  );

  // create permission account and approve if necessary
  const permissionAccount = await sbv2.PermissionAccount.create(
    oracleQueue.program,
    {
      authority: queue.authority,
      granter: oracleQueue.publicKey,
      grantee: aggregatorAccount.publicKey,
    }
  );
  if (!queue.unpermissionedFeedsEnabled) {
    if (queue.authority.equals(payerKeypair.publicKey)) {
      await permissionAccount.set({
        authority: payerKeypair,
        enable: true,
        permission: sbv2.SwitchboardPermission.PERMIT_ORACLE_QUEUE_USAGE,
      });
    }
    throw new Error(
      `must provide queue authority to permit data feeds to join`
    );
  }

  // create lease contract
  const leaseAccount = await sbv2.LeaseAccount.create(oracleQueue.program, {
    aggregatorAccount,
    funder: payoutWallet,
    funderAuthority: payerKeypair,
    loadAmount: new anchor.BN(0),
    oracleQueueAccount: oracleQueue,
  });

  // create and add job account
  const staticJob = await sbv2.JobAccount.create(aggregatorAccount.program, {
    name: Buffer.from(`Value ${value}`),
    authorWallet: payoutWallet,
    data: Buffer.from(
      OracleJob.encodeDelimited(
        OracleJob.create({
          tasks: [
            OracleJob.Task.create({
              valueTask: OracleJob.ValueTask.create({
                value,
              }),
            }),
          ],
        })
      ).finish()
    ),
  });
  await aggregatorAccount.addJob(staticJob);

  // open new round and request new result
  await aggregatorAccount.openRound({
    oracleQueueAccount: oracleQueue,
    payoutWallet,
  });

  return aggregatorAccount;
};

export const getProgramDataAddress = (programId: PublicKey): PublicKey => {
  return findProgramAddressSync(
    [programId.toBytes()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
  )[0];
};

export const getIdlAddress = async (
  programId: PublicKey
): Promise<PublicKey> => {
  const base = (await PublicKey.findProgramAddress([], programId))[0];
  return PublicKey.createWithSeed(base, "anchor:idl", programId);
};

/**
 * Update a Switchboard aggregator with a set value.
 * This function will remove the current job, add a valueTask that resolves to your value,
 * then wait for the aggregatorAccount state to update with the expected value
 */
export const setSwitchboardFeed = async (
  aggregatorAccount: sbv2.AggregatorAccount,
  value: number,
  payoutWallet: PublicKey,
  timeout = 30
) => {
  const aggregator = await aggregatorAccount.loadData();
  const expectedValue = new Big(value);

  const oracleQueueAccount = new sbv2.OracleQueueAccount({
    program: aggregatorAccount.program,
    publicKey: aggregator.queuePubkey,
  });
  const queue = await oracleQueueAccount.loadData();

  // remove all existing jobs
  const existingJobs: sbv2.JobAccount[] = aggregator.jobPubkeysData
    // eslint-disable-next-line array-callback-return
    .filter((jobKey: PublicKey) => {
      if (!jobKey.equals(DEFAULT_PUBKEY)) {
        return jobKey;
      }
    })
    .map(
      (jobKey) =>
        new sbv2.JobAccount({
          program: aggregatorAccount.program,
          publicKey: jobKey,
        })
    );
  await Promise.all(
    existingJobs.map((job) => aggregatorAccount.removeJob(job))
  );

  // add new static job
  const staticJob = await sbv2.JobAccount.create(aggregatorAccount.program, {
    name: Buffer.from(`Value ${value}`),
    data: Buffer.from(
      OracleJob.encodeDelimited(
        OracleJob.create({
          tasks: [
            OracleJob.Task.create({
              valueTask: OracleJob.ValueTask.create({
                value,
              }),
            }),
          ],
        })
      ).finish()
    ),
  });
  await aggregatorAccount.addJob(staticJob);

  // call open round and wait for new value
  const accountsCoder = new anchor.BorshAccountsCoder(
    aggregatorAccount.program.idl
  );

  let accountWs: number;
  const awaitUpdatePromise = new Promise((resolve: (value: Big) => void) => {
    accountWs = aggregatorAccount.program.provider.connection.onAccountChange(
      aggregatorAccount.publicKey,
      async (accountInfo) => {
        const aggregator = accountsCoder.decode(
          "AggregatorAccountData",
          accountInfo.data
        );
        const latestResult = await aggregatorAccount.getLatestValue(aggregator);
        if (latestResult.eq(expectedValue)) {
          resolve(latestResult);
        }
      }
    );
  });

  const updatedValuePromise = promiseWithTimeout(
    timeout * 1000,
    awaitUpdatePromise,
    new Error(`aggregator failed to update in ${timeout} seconds`)
  ).finally(() => {
    // this doesnt always close
    if (accountWs) {
      aggregatorAccount.program.provider.connection.removeAccountChangeListener(
        accountWs
      );
    }
  });

  await aggregatorAccount.openRound({
    oracleQueueAccount: oracleQueueAccount,
    payoutWallet: payoutWallet,
  });

  await updatedValuePromise;

  if (!updatedValuePromise) {
    throw new Error(`failed to update aggregator`);
  }
};
