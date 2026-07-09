import type { FastifyReply } from 'fastify';

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

// One error shape everywhere: { statusCode, error, code, message }.
// `code` is a stable machine-readable identifier the frontend can switch on.
export function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply
    .code(statusCode)
    .send({ statusCode, error: STATUS_TEXT[statusCode] ?? 'Error', code, message });
}

// Prisma 7 driver adapters report the violated unique-constraint fields under
// meta.driverAdapterError, not meta.target like the classic engine did
export function p2002Fields(err: unknown): string[] {
  const meta = (err as { meta?: Record<string, any> }).meta;
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target ?? [];
  const list = Array.isArray(fields) ? fields : [fields];
  return list.map((f: unknown) => String(f).replace(/"/g, ''));
}

export function isP2002(err: unknown, field?: string): boolean {
  const code = (err as { code?: string }).code;
  if (code !== 'P2002') return false;
  return field === undefined || p2002Fields(err).includes(field);
}
