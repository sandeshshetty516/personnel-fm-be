import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import * as budgetsService from './budgets.service';

type DateQuery = { date?: string };

export const list: RequestHandler = async (req, res) => {
  const { date } = res.locals.query as DateQuery;
  sendSuccess(res, { budgets: await budgetsService.listBudgets(getAuth(req).userId, date) });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { budget: await budgetsService.getBudget(getAuth(req).userId, req.params.id) });
};

export const summary: RequestHandler<{ id: string }> = async (req, res) => {
  const { date } = res.locals.query as DateQuery;
  sendSuccess(res, { summary: await budgetsService.getBudgetSummary(getAuth(req).userId, req.params.id, date) });
};

export const create: RequestHandler = async (req, res) => {
  sendSuccess(res, { budget: await budgetsService.createBudget(getAuth(req).userId, req.body) }, 201);
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { budget: await budgetsService.updateBudget(getAuth(req).userId, req.params.id, req.body) });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, await budgetsService.deleteBudget(getAuth(req).userId, req.params.id));
};
