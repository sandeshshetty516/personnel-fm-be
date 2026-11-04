import { Router } from 'express';
import { idParamsSchema } from '../../common/schemas';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './transactions.controller';
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  transactionFiltersSchema,
  updateTransactionSchema,
} from './transactions.schemas';
import './transactions.docs';

export const transactionsRouter = Router();

transactionsRouter.use(authenticate);
transactionsRouter.get('/', validate({ query: listTransactionsQuerySchema }), controller.list);
// Registered before "/:id" so "summary" is not treated as an id.
transactionsRouter.get('/summary', validate({ query: transactionFiltersSchema }), controller.summary);
transactionsRouter.post('/', validate({ body: createTransactionSchema }), controller.create);
transactionsRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);
transactionsRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateTransactionSchema }),
  controller.update,
);
transactionsRouter.delete('/:id', validate({ params: idParamsSchema }), controller.remove);
