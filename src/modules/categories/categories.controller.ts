import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import * as categoriesService from './categories.service';
import type { CategoryType } from './category.model';

export const list: RequestHandler = async (req, res) => {
  const filters = res.locals.query as { type?: CategoryType; includeArchived?: boolean };
  sendSuccess(res, { categories: await categoriesService.listCategories(getAuth(req).userId, filters) });
};

export const create: RequestHandler = async (req, res) => {
  sendSuccess(res, { category: await categoriesService.createCategory(getAuth(req).userId, req.body) }, 201);
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, {
    category: await categoriesService.updateCategory(getAuth(req).userId, req.params.id, req.body),
  });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  const { reassignTo } = res.locals.query as { reassignTo?: string };
  sendSuccess(res, await categoriesService.deleteCategory(getAuth(req).userId, req.params.id, reassignTo));
};
