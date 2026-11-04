import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './users.controller';
import { changePasswordSchema, updateProfileSchema } from './users.schemas';
import './users.docs';

export const usersRouter = Router();

usersRouter.use(authenticate);
usersRouter.get('/me', controller.getProfile);
usersRouter.patch('/me', validate({ body: updateProfileSchema }), controller.updateProfile);
usersRouter.post('/me/change-password', validate({ body: changePasswordSchema }), controller.changePassword);
