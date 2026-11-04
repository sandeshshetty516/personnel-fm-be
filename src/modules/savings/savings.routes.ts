import { Router } from 'express';
import { idParamsSchema } from '../../common/schemas';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './savings.controller';
import {
  contributionParamsSchema,
  createContributionSchema,
  createGoalSchema,
  listGoalsQuerySchema,
  updateGoalSchema,
} from './savings.schemas';
import './savings.docs';

export const savingsRouter = Router();

savingsRouter.use(authenticate);
savingsRouter.get('/', validate({ query: listGoalsQuerySchema }), controller.list);
savingsRouter.post('/', validate({ body: createGoalSchema }), controller.create);
savingsRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);
savingsRouter.patch('/:id', validate({ params: idParamsSchema, body: updateGoalSchema }), controller.update);
savingsRouter.get('/:id/history', validate({ params: idParamsSchema }), controller.history);
savingsRouter.post(
  '/:id/contributions',
  validate({ params: idParamsSchema, body: createContributionSchema }),
  controller.addContribution,
);
savingsRouter.delete(
  '/:id/contributions/:contributionId',
  validate({ params: contributionParamsSchema }),
  controller.deleteContribution,
);
