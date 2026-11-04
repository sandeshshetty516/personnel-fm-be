import { AppError } from '../../common/errors';
import { UserModel } from '../users/user.model';
import { AccountModel, type AccountDocument } from './account.model';
import { getNetMovements } from './accountBalance.service';
import type { AccountResponse, CreateAccountInput, UpdateAccountInput } from './accounts.schemas';

function toResponse(account: AccountDocument, netPaise: number): AccountResponse {
  return {
    id: account._id.toString(),
    name: account.name,
    accountType: account.accountType,
    currency: account.currency,
    openingBalancePaise: account.openingBalancePaise,
    currentBalancePaise: account.openingBalancePaise + netPaise,
    institution: account.institution ?? null,
    lastFourDigits: account.lastFourDigits ?? null,
    isActive: account.isActive,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

async function withBalances(userId: string, accounts: AccountDocument[]): Promise<AccountResponse[]> {
  const movements = await getNetMovements(
    userId,
    accounts.map((a) => a._id),
  );
  return accounts.map((account) => toResponse(account, movements.get(account._id.toString()) ?? 0));
}

function duplicateNameGuard(err: unknown): never {
  if ((err as { code?: number }).code === 11000) {
    throw AppError.conflict('You already have an account with this name');
  }
  throw err;
}

/**
 * Loads an account only if it belongs to the user. Another user's id is reported as
 * "not found" rather than "forbidden", so ids cannot be probed (AC-03).
 */
export async function findOwnedAccount(userId: string, accountId: string): Promise<AccountDocument> {
  const account = await AccountModel.findOne({ _id: accountId, userId });
  if (!account) throw AppError.notFound('Account not found');
  return account;
}

export async function listAccounts(userId: string, includeInactive = false): Promise<AccountResponse[]> {
  const accounts = await AccountModel.find({ userId, ...(includeInactive ? {} : { isActive: true }) }).sort({
    isActive: -1,
    createdAt: 1,
  });
  return withBalances(userId, accounts);
}

export async function getAccount(userId: string, accountId: string): Promise<AccountResponse> {
  const [account] = await withBalances(userId, [await findOwnedAccount(userId, accountId)]);
  return account!;
}

export async function createAccount(userId: string, input: CreateAccountInput): Promise<AccountResponse> {
  let currency = input.currency;
  if (!currency) {
    const user = await UserModel.findById(userId).select('currency');
    currency = user?.currency ?? 'INR';
  }
  const account = await AccountModel.create({ ...input, currency, userId }).catch(duplicateNameGuard);
  return toResponse(account, 0);
}

export async function updateAccount(
  userId: string,
  accountId: string,
  input: UpdateAccountInput,
): Promise<AccountResponse> {
  const account = await findOwnedAccount(userId, accountId);
  const { institution, lastFourDigits, ...rest } = input;
  account.set(rest);
  // null in the request clears an optional field.
  if (institution !== undefined) account.set('institution', institution ?? undefined);
  if (lastFourDigits !== undefined) account.set('lastFourDigits', lastFourDigits ?? undefined);
  await account.save().catch(duplicateNameGuard);
  return getAccount(userId, accountId);
}

/**
 * Accounts are deactivated, never deleted: their transactions remain part of history and reports (FR-010).
 */
export async function deactivateAccount(userId: string, accountId: string): Promise<AccountResponse> {
  const account = await findOwnedAccount(userId, accountId);
  account.isActive = false;
  await account.save();
  return getAccount(userId, accountId);
}
