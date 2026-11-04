import { z } from 'zod';
import { errorResponses, json, protectedRead, registry, successResponse } from '../../docs/openapi';
import {
  breakdownFields,
  cashFlowBucketSchema,
  categorySliceSchema,
  dashboardSummarySchema,
  periodFields,
  recentFields,
  recentTransactionsSchema,
  savingsBucketSchema,
} from './dashboard.schemas';

const { 400: badRequest, 401: unauthorized } = errorResponses;
const period = z.object({ from: z.string(), to: z.string(), currency: z.string() });

const paths = [
  {
    path: '/dashboard/summary',
    summary: 'Income, expenses, net cash flow, savings rate and total balance for the period',
    request: { query: periodFields },
    data: dashboardSummarySchema,
  },
  {
    path: '/dashboard/cash-flow',
    summary: 'Income and expenses per financial month (max 24 months)',
    request: { query: periodFields },
    data: z.object({ period, buckets: z.array(cashFlowBucketSchema) }),
  },
  {
    path: '/dashboard/savings-trend',
    summary: 'Net savings per financial month, running total and savings rate',
    request: { query: periodFields },
    data: z.object({ period, buckets: z.array(savingsBucketSchema) }),
  },
  {
    path: '/dashboard/category-breakdown',
    summary: 'Totals per category for the period, largest first',
    request: { query: breakdownFields },
    data: z.object({
      period,
      type: z.enum(['EXPENSE', 'INCOME']),
      totalPaise: z.number().int(),
      categories: z.array(categorySliceSchema),
    }),
  },
  {
    path: '/dashboard/recent-transactions',
    summary: 'Latest transactions in the period (transfers once)',
    request: { query: recentFields },
    data: z.object({ period, transactions: recentTransactionsSchema }),
  },
];

for (const { path, summary, request, data } of paths) {
  registry.registerPath({
    method: 'get',
    path,
    tags: ['Dashboard'],
    summary,
    description:
      'All dashboard endpoints share the period (from/to, default: current financial month) and currency ' +
      "(default: the user's preferred currency). Only accounts in that currency are included; transfers never count.",
    security: protectedRead,
    request,
    responses: { 200: json('OK', successResponse(data)), 400: badRequest, 401: unauthorized },
  });
}
