declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware on protected routes. */
      auth?: {
        userId: string;
        sessionId: string;
      };
    }
  }
}

export {};
