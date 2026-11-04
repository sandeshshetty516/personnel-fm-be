import { Router } from 'express';
import { idParamsSchema } from '../../common/schemas';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  createCategorySchema,
  deleteCategoryQuerySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './categories.schemas';
import * as controller from './categories.controller';
import './categories.docs';

export const categoriesRouter = Router();

categoriesRouter.use(authenticate);
categoriesRouter.get('/', validate({ query: listCategoriesQuerySchema }), controller.list);
categoriesRouter.post('/', validate({ body: createCategorySchema }), controller.create);
categoriesRouter.patch('/:id', validate({ params: idParamsSchema, body: updateCategorySchema }), controller.update);
categoriesRouter.delete(
  '/:id',
  validate({ params: idParamsSchema, query: deleteCategoryQuerySchema }),
  controller.remove,
);
