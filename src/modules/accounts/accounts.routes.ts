import { Router } from 'express';
import { idParamsSchema } from '../../common/schemas';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './accounts.controller';
import { createAccountSchema, listAccountsQuerySchema, updateAccountSchema } from './accounts.schemas';
import * as transactionsController from '../transactions/transactions.controller';
import { createTransferSchema } from '../transactions/transactions.schemas';
import './accounts.docs';

export const accountsRouter = Router();

accountsRouter.use(authenticate);
accountsRouter.get('/', validate({ query: listAccountsQuerySchema }), controller.list);
accountsRouter.post('/', validate({ body: createAccountSchema }), controller.create);
// Registered before "/:id" routes so "transfer" is not treated as an id.
accountsRouter.post('/transfer', validate({ body: createTransferSchema }), transactionsController.createTransfer);
accountsRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);
accountsRouter.patch('/:id', validate({ params: idParamsSchema, body: updateAccountSchema }), controller.update);
accountsRouter.delete('/:id', validate({ params: idParamsSchema }), controller.deactivate);
