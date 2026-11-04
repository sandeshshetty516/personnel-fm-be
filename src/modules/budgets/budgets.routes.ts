import { Router } from 'express';
import { idParamsSchema } from '../../common/schemas';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './budgets.controller';
import { budgetDateQuerySchema, createBudgetSchema, updateBudgetSchema } from './budgets.schemas';
import './budgets.docs';

export const budgetsRouter = Router();

budgetsRouter.use(authenticate);
budgetsRouter.get('/', validate({ query: budgetDateQuerySchema }), controller.list);
budgetsRouter.post('/', validate({ body: createBudgetSchema }), controller.create);
budgetsRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);
budgetsRouter.get(
  '/:id/summary',
  validate({ params: idParamsSchema, query: budgetDateQuerySchema }),
  controller.summary,
);
budgetsRouter.patch('/:id', validate({ params: idParamsSchema, body: updateBudgetSchema }), controller.update);
budgetsRouter.delete('/:id', validate({ params: idParamsSchema }), controller.remove);
