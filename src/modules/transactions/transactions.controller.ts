import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import type { ListTransactionsQuery, TransactionFilters } from './transactions.schemas';
import * as transactionsService from './transactions.service';
import * as transferService from './transfer.service';

export const list: RequestHandler = async (req, res) => {
  const { transactions, meta } = await transactionsService.listTransactions(
    getAuth(req).userId,
    res.locals.query as ListTransactionsQuery,
  );
  sendSuccess(res, { transactions }, 200, meta);
};

export const summary: RequestHandler = async (req, res) => {
  const summaries = await transactionsService.summarizeTransactions(
    getAuth(req).userId,
    res.locals.query as TransactionFilters,
  );
  sendSuccess(res, { summaries });
};

export const getOne: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, { transaction: await transactionsService.getTransaction(getAuth(req).userId, req.params.id) });
};

export const create: RequestHandler = async (req, res) => {
  sendSuccess(res, { transaction: await transactionsService.createTransaction(getAuth(req).userId, req.body) }, 201);
};

export const update: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, {
    transaction: await transactionsService.updateTransaction(getAuth(req).userId, req.params.id, req.body),
  });
};

export const remove: RequestHandler<{ id: string }> = async (req, res) => {
  sendSuccess(res, await transactionsService.deleteTransaction(getAuth(req).userId, req.params.id));
};

export const createTransfer: RequestHandler = async (req, res) => {
  sendSuccess(res, { transfer: await transferService.createTransfer(getAuth(req).userId, req.body) }, 201);
};
