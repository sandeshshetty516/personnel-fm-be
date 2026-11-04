import { Router } from 'express';
import { csrfProtection } from './middleware/csrf';
import { accountsRouter } from './modules/accounts/accounts.routes';
import { authRouter } from './modules/auth/auth.routes';
import { budgetsRouter } from './modules/budgets/budgets.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { healthRouter } from './modules/health/health.routes';
import { savingsRouter } from './modules/savings/savings.routes';
import { transactionsRouter } from './modules/transactions/transactions.routes';
import { usersRouter } from './modules/users/users.routes';

/** Mounts every feature module under /api/v1. */
export const apiRouter = Router();

// Every state-changing request, including login and register, must carry a valid CSRF token.
apiRouter.use(csrfProtection);

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/budgets', budgetsRouter);
apiRouter.use('/savings-goals', savingsRouter);
