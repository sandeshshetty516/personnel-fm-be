import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import * as accountsService from './accounts.service';

export const list: RequestHandler = async (req, res) => {
  const { includeInactive } = res.locals.query as { includeInactive?: boolean };
  sendSuccess(res, { accounts: await accountsService.listAccounts(getAuth(req).userId, includeInactive) });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { account: await accountsService.getAccount(getAuth(req).userId, req.params.id) });
};

export const create: RequestHandler = async (req, res) => {
  sendSuccess(res, { account: await accountsService.createAccount(getAuth(req).userId, req.body) }, 201);
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { account: await accountsService.updateAccount(getAuth(req).userId, req.params.id, req.body) });
};

export const deactivate: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { account: await accountsService.deactivateAccount(getAuth(req).userId, req.params.id) });
};
