import { Router } from 'express';
import { idParamsSchema } from '../../common/schemas';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './debts.controller';
import {
  createDebtEntrySchema,
  createDebtSchema,
  debtEntryParamsSchema,
  listDebtsQuerySchema,
  updateDebtSchema,
} from './debts.schemas';
import './debts.docs';

export const debtsRouter = Router();

debtsRouter.use(authenticate);
debtsRouter.get('/', validate({ query: listDebtsQuerySchema }), controller.list);
debtsRouter.post('/', validate({ body: createDebtSchema }), controller.create);
// Registered before /:id so "summary" is not read as an id.
debtsRouter.get('/summary', controller.summary);
debtsRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);
debtsRouter.patch('/:id', validate({ params: idParamsSchema, body: updateDebtSchema }), controller.update);
debtsRouter.delete('/:id', validate({ params: idParamsSchema }), controller.remove);
debtsRouter.get('/:id/entries', validate({ params: idParamsSchema }), controller.entries);
debtsRouter.post(
  '/:id/entries',
  validate({ params: idParamsSchema, body: createDebtEntrySchema }),
  controller.addEntry,
);
debtsRouter.delete('/:id/entries/:entryId', validate({ params: debtEntryParamsSchema }), controller.deleteEntry);
