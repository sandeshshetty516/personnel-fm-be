import type { RequestHandler } from 'express';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import { getCurrentUser } from '../auth/auth.service';
import * as usersService from './users.service';

export const getProfile: RequestHandler = async (req, res) => {
  sendSuccess(res, { user: await getCurrentUser(getAuth(req).userId) });
};

export const updateProfile: RequestHandler = async (req, res) => {
  sendSuccess(res, { user: await usersService.updateProfile(getAuth(req).userId, req.body) });
};

export const changePassword: RequestHandler = async (req, res) => {
  const { userId, sessionId } = getAuth(req);
  await usersService.changePassword(userId, sessionId, req.body);
  sendSuccess(res, { message: 'Password changed. Other devices have been signed out.' });
};
