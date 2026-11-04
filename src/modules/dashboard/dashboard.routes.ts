import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './dashboard.controller';
import { breakdownQuerySchema, periodQuerySchema, recentQuerySchema } from './dashboard.schemas';
import './dashboard.docs';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);
dashboardRouter.get('/summary', validate({ query: periodQuerySchema }), controller.summary);
dashboardRouter.get('/cash-flow', validate({ query: periodQuerySchema }), controller.cashFlow);
dashboardRouter.get('/savings-trend', validate({ query: periodQuerySchema }), controller.savingsTrend);
dashboardRouter.get('/category-breakdown', validate({ query: breakdownQuerySchema }), controller.categoryBreakdown);
dashboardRouter.get('/recent-transactions', validate({ query: recentQuerySchema }), controller.recentTransactions);
