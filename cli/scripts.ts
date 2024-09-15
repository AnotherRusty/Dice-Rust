import { Program, web3 } from '@project-serum/anchor';
import * as anchor from '@project-serum/anchor';
import {
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID, AccountLayout, MintLayout, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import fs from 'fs';
import { GlobalPool, PlayerPool } from './types';
import NodeWallet from '@project-serum/anchor/dist/cjs/nodewallet';

const PLAYER_POOL_SIZE = 120;
const GLOBAL_AUTHORITY_SEED = "global-authority";
const VAULT_AUTHORITY_SEED = "vault-authority";
const RANDOM_SEED = "set-random-number";

const ADMIN_PUBKEY = new PublicKey("Fs8R7R6dP3B7mAJ6QmWZbomBRuTbiJyiR4QYjoxhLdPu");
const PROGRAM_ID = "EpMU3YEiEXY1eWZHbqBuKj2zPuMbSvMZjDEMg2sSW6eP";

anchor.setProvider(anchor.Provider.local(web3.clusterApiUrl('devnet')));
const solConnection = anchor.getProvider().connection;
const payer = anchor.getProvider().wallet;

let rewardVault: PublicKey = null;
let program: Program = null;

// Configure the client to use the local cluster.
// const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve("/home/fury/.config/solana/id.json"), 'utf-8'))), { skipValidation: true });

const idl = JSON.parse(
    fs.readFileSync(__dirname + "/dice_gaming.json", "utf8")
);

// Address of the deployed program.
const programId = new anchor.web3.PublicKey(PROGRAM_ID);

// Generate the program client from IDL.
program = new anchor.Program(idl, programId);
console.log('ProgramId: ', program.programId.toBase58());

const main = async () => {
    const [globalAuthority, bump] = await PublicKey.findProgramAddress(
        [Buffer.from(GLOBAL_AUTHORITY_SEED)],
        program.programId
    );
    console.log('GlobalAuthority: ', globalAuthority.toBase58());

    const [rewardVault, vaultBump] = await PublicKey.findProgramAddress(
        [Buffer.from(VAULT_AUTHORITY_SEED)],
        program.programId
    );
    console.log('RewardVault: ', rewardVault.toBase58());

    // await initProject();

    const globalPool: GlobalPool = await getGlobalState();
    console.log("globalPool =", globalPool.superAdmin.toBase58(), globalPool.totalRound.toNumber());

    // await initUserPool(payer.publicKey);
    await playGame(payer.publicKey, new anchor.BN(10000000));

    const userPool: PlayerPool = await getUserPoolState(payer.publicKey);
    console.log(userPool);
    console.log(userPool.player.toBase58(), userPool.gameData.rand1.toNumber());
    // console.log({
    //     // ...userPool,
    //     player: userPool.player.toBase58(),
    //     round: userPool.round.toNumber(),
    //     gameDatas: {
    //         // ...info,
    //         playTime: userPool.gameData.playTime.toNumber(),
    //         amount: userPool.gameData.amout.toNumber(),
    //         rewardAmount: userPool.gameData.rewardAmount.toNumber(),
    //         rand1: userPool.gameData.rand1.toNumber(),
    //         rand2: userPool.gameData.rand2.toNumber(),
    //         rand3: userPool.gameData.rand3.toNumber(),
    //         rand4: userPool.gameData.rand4.toNumber(),
    //     },
    //     winTimes: userPool.winTimes.toNumber(),
    //     receivedReward: userPool.receivedReward.toNumber(),
    // });
};

export const initProject = async (
) => {
    const [globalAuthority, bump] = await PublicKey.findProgramAddress(
        [Buffer.from(GLOBAL_AUTHORITY_SEED)],
        program.programId
    );
    const [rewardVault, vaultBump] = await PublicKey.findProgramAddress(
        [Buffer.from(VAULT_AUTHORITY_SEED)],
        program.programId
    );
    console.log(rewardVault);

    const tx = await program.rpc.initialize(
        bump, vaultBump, {
        accounts: {
            admin: payer.publicKey,
            globalAuthority,
            rewardVault: rewardVault,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
        },
        signers: [],
    });
    await solConnection.confirmTransaction(tx, "confirmed");

    console.log("txHash =", tx);
    return false;
}

export const initUserPool = async (
    userAddress: PublicKey,
) => {
    let playerPoolKey = await PublicKey.createWithSeed(
        userAddress,
        "player-pool",
        program.programId,
    );

    console.log(playerPoolKey.toBase58());
    let ix = SystemProgram.createAccountWithSeed({
        fromPubkey: userAddress,
        basePubkey: userAddress,
        seed: "player-pool",
        newAccountPubkey: playerPoolKey,
        lamports: await solConnection.getMinimumBalanceForRentExemption(PLAYER_POOL_SIZE),
        space: PLAYER_POOL_SIZE,
        programId: program.programId,
    });
    const tx = await program.rpc.initializePlayerPool(
        {
            accounts: {
                playerPool: playerPoolKey,
                owner: userAddress
            },
            instructions: [
                ix
            ],
            signers: []
        }
    );
    await solConnection.confirmTransaction(tx, "confirmed");

    console.log("Your transaction signature", tx);
    let poolAccount = await program.account.playerPool.fetch(playerPoolKey);
    console.log('Owner of initialized pool = ', poolAccount.player.toBase58());
}

export const playGame = async (userAddress: PublicKey, deposit: anchor.BN) => {

    const [globalAuthority, bump] = await PublicKey.findProgramAddress(
        [Buffer.from(GLOBAL_AUTHORITY_SEED)],
        program.programId
    );
    console.log('GlobalAuthority: ', globalAuthority.toBase58());

    const [rewardVault, vaultBump] = await PublicKey.findProgramAddress(
        [Buffer.from(VAULT_AUTHORITY_SEED)],
        program.programId
    );
    console.log('RewardVault: ', rewardVault.toBase58());
    let playerPoolKey = await PublicKey.createWithSeed(
        userAddress,
        "player-pool",
        program.programId,
    );

    let poolAccount = await solConnection.getAccountInfo(playerPoolKey);
    if (poolAccount === null || poolAccount.data === null) {
        console.log('init');
        await initUserPool(userAddress);
    }

    const tx = await program.rpc.playGame(
        bump, vaultBump, deposit, {
        accounts: {
            owner: userAddress,
            playerPool: playerPoolKey,
            globalAuthority,
            rewardVault: rewardVault,
            systemProgram: SystemProgram.programId,
        },
        signers: [],
    });

    await solConnection.confirmTransaction(tx, "singleGossip");
    let userPoolData = await program.account.playerPool.fetch(playerPoolKey);
    let k = userPoolData.round.toNumber();
    console.log(k);

    console.log(userPoolData.gameData);
    return userPoolData.gameData;
}


export const getGlobalState = async (
): Promise<GlobalPool | null> => {
    const [globalAuthority, bump] = await PublicKey.findProgramAddress(
        [Buffer.from(GLOBAL_AUTHORITY_SEED)],
        program.programId
    );
    try {
        let globalState = await program.account.globalPool.fetch(globalAuthority);
        return globalState as GlobalPool;
    } catch {
        return null;
    }
}

export const getUserPoolState = async (
    userAddress: PublicKey
): Promise<PlayerPool | null> => {
    if (!userAddress) return null;

    let playerPoolKey = await PublicKey.createWithSeed(
        userAddress,
        "player-pool",
        program.programId,
    );
    console.log('Player Pool: ', playerPoolKey.toBase58());
    try {
        let poolState = await program.account.playerPool.fetch(playerPoolKey);
        return poolState as PlayerPool;
    } catch {
        return null;
    }
}

main();