import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import type { GoalStatus } from './savings.models';
import * as savingsService from './savings.service';

export const list: RequestHandler = async (req, res) => {
  const { status } = res.locals.query as { status?: GoalStatus };
  sendSuccess(res, { goals: await savingsService.listGoals(getAuth(req).userId, status) });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { goal: await savingsService.getGoal(getAuth(req).userId, req.params.id) });
};

export const create: RequestHandler = async (req, res) => {
  sendSuccess(res, { goal: await savingsService.createGoal(getAuth(req).userId, req.body) }, 201);
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { goal: await savingsService.updateGoal(getAuth(req).userId, req.params.id, req.body) });
};

export const addContribution: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, await savingsService.addContribution(getAuth(req).userId, req.params.id, req.body), 201);
};

export const deleteContribution: RequestHandler<{ id: string; contributionId: string }> = async (req, res) => {
  sendSuccess(res, {
    goal: await savingsService.deleteContribution(getAuth(req).userId, req.params.id, req.params.contributionId),
  });
};

export const history: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { contributions: await savingsService.getHistory(getAuth(req).userId, req.params.id) });
};
