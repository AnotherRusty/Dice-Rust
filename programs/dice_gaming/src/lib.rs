use anchor_lang::{prelude::*, System};

use solana_program::pubkey::Pubkey;
use solana_program::{program::invoke, system_instruction};

pub mod account;
pub mod constants;
pub mod error;
pub mod utils;

use account::*;
use constants::*;
use error::*;
use utils::*;

declare_id!("EpMU3YEiEXY1eWZHbqBuKj2zPuMbSvMZjDEMg2sSW6eP");

#[program]
pub mod dice_gaming {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, global_bump: u8, vault_bump: u8) -> ProgramResult {
        let global_authority = &mut ctx.accounts.global_authority;
        global_authority.super_admin = ctx.accounts.admin.key();
        // Err(ProgramError::from(StakingError::InvalidSuperOwner))
        Ok(())
    }

    pub fn initialize_player_pool(ctx: Context<InitializePlayerPool>) -> ProgramResult {
        let mut player_pool = ctx.accounts.player_pool.load_init()?;
        player_pool.player = ctx.accounts.owner.key();
        msg!("Owner: {:?}", player_pool.player.to_string());
        // Err(ProgramError::from(StakingError::InvalidSuperOwner))
        Ok(())
    }

    #[access_control(user(&ctx.accounts.player_pool, &ctx.accounts.owner))]
    pub fn play_game(
        ctx: Context<PlayRound>,
        global_bump: u8,
        vault_bump: u8,
        deposit: u64,
    ) -> ProgramResult {
        let mut player_pool = ctx.accounts.player_pool.load_mut()?;
        msg!("Deopsit: {}", deposit);
        msg!(
            "Vault: {}",
            ctx.accounts.reward_vault.to_account_info().key()
        );
        msg!(
            "Lamports: {}",
            ctx.accounts.reward_vault.to_account_info().lamports()
        );
        msg!(
            "Owner Lamports: {}",
            ctx.accounts.owner.to_account_info().lamports()
        );
        require!(
            ctx.accounts.reward_vault.to_account_info().lamports() > 2 * deposit,
            GameError::InsufficientRewardVault
        );
        sol_transfer_user(
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.reward_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            deposit,
        )?;

        let mut reward: u64 = 0;
        let timestamp = Clock::get()?.unix_timestamp;
        let owner_address = ctx.accounts.owner.to_account_info().key();
        let (player_address, bump) = Pubkey::find_program_address(
            &[
                RANDOM_SEED.as_bytes(),
                timestamp.to_string().as_bytes(),
                &owner_address.to_bytes(),
            ],
            &dice_gaming::ID,
        );

        let char_vec: Vec<char> = player_address.to_string().chars().collect();
        let sys_one: u64 = rand(char_vec[0]);
        let sys_two: u64 = rand(char_vec[5]);
        let player_one: u64 = rand(char_vec[3]);
        let player_two: u64 = rand(char_vec[7]);

        if (sys_one + sys_two) < (player_one + player_two) {
            reward = deposit * 2;
            sol_transfer_with_signer(
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                &[&[VAULT_AUTHORITY_SEED.as_ref(), &[vault_bump]]],
                reward,
            )?;
        }

        player_pool.add_game_data(
            timestamp, deposit, reward, sys_one, sys_two, player_one, player_two,
        );

        ctx.accounts.global_authority.total_round += 1;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(global_bump: u8, vault_bump: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        seeds = [GLOBAL_AUTHORITY_SEED.as_ref()],
        bump = global_bump,
        payer = admin
    )]
    pub global_authority: Account<'info, GlobalPool>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED.as_ref()],
        bump = vault_bump,
    )]
    pub reward_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializePlayerPool<'info> {
    #[account(zero)]
    pub player_pool: AccountLoader<'info, PlayerPool>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(
    global_bump: u8,
    vault_bump: u8,
    deposit: u64
)]
pub struct PlayRound<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub player_pool: AccountLoader<'info, PlayerPool>,

    #[account(
        mut,
        seeds = [GLOBAL_AUTHORITY_SEED.as_ref()],
        bump = global_bump,
    )]
    pub global_authority: Box<Account<'info, GlobalPool>>,

    #[account(
        mut,
        seeds = [VAULT_AUTHORITY_SEED.as_ref()],
        bump = vault_bump,
    )]
    pub reward_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// Access control modifiers
fn user(pool_loader: &AccountLoader<PlayerPool>, user: &AccountInfo) -> Result<()> {
    let user_pool = pool_loader.load()?;
    require!(user_pool.player == *user.key, GameError::InvalidPlayerPool);
    Ok(())
}

fn rand(char: char) -> u64 {
    let number = u32::from(char);
    let rest = number % 6 + 1;
    return rest as u64;
}
