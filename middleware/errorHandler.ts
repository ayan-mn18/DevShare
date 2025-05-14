import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types/api';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
) => {
  console.error(err);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      status: 'FAILURE',
      message: err.message,
      data: null
    });
  }

  res.status(500).json({
    status: 'FAILURE',
    message: 'Internal server error',
    data: null
  });
};