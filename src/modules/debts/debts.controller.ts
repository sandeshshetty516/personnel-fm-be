import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import type { DebtDirection, DebtStatus } from './debt.models';
import * as debtsService from './debts.service';

export const list: RequestHandler = async (req, res) => {
  const filters = res.locals.query as { direction?: DebtDirection; status?: DebtStatus };
  sendSuccess(res, { debts: await debtsService.listDebts(getAuth(req).userId, filters) });
};

export const summary: RequestHandler = async (req, res) => {
  sendSuccess(res, { summaries: await debtsService.getSummary(getAuth(req).userId) });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { debt: await debtsService.getDebt(getAuth(req).userId, req.params.id) });
};

export const create: RequestHandler = async (req, res) => {
  sendSuccess(res, await debtsService.createDebt(getAuth(req).userId, req.body), 201);
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { debt: await debtsService.updateDebt(getAuth(req).userId, req.params.id, req.body) });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, await debtsService.deleteDebt(getAuth(req).userId, req.params.id));
};

export const entries: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { entries: await debtsService.getEntries(getAuth(req).userId, req.params.id) });
};

export const addEntry: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, await debtsService.addEntry(getAuth(req).userId, req.params.id, req.body), 201);
};

export const deleteEntry: RequestHandler<{ id: string; entryId: string }> = async (req, res) => {
  sendSuccess(res, {
    debt: await debtsService.deleteEntry(getAuth(req).userId, req.params.id, req.params.entryId),
  });
};
