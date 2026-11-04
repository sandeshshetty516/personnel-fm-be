import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import type { BreakdownQuery, PeriodQuery, RecentQuery } from './dashboard.schemas';
import * as dashboardService from './dashboard.service';

export const summary: RequestHandler = async (req, res) => {
  sendSuccess(res, await dashboardService.getSummary(getAuth(req).userId, res.locals.query as PeriodQuery));
};

export const cashFlow: RequestHandler = async (req, res) => {
  sendSuccess(res, await dashboardService.getCashFlow(getAuth(req).userId, res.locals.query as PeriodQuery));
};

export const savingsTrend: RequestHandler = async (req, res) => {
  sendSuccess(res, await dashboardService.getSavingsTrend(getAuth(req).userId, res.locals.query as PeriodQuery));
};

export const categoryBreakdown: RequestHandler = async (req, res) => {
  sendSuccess(
    res,
    await dashboardService.getCategoryBreakdown(getAuth(req).userId, res.locals.query as BreakdownQuery),
  );
};

export const recentTransactions: RequestHandler = async (req, res) => {
  sendSuccess(res, await dashboardService.getRecentTransactions(getAuth(req).userId, res.locals.query as RecentQuery));
};
