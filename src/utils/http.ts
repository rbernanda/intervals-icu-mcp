import { AppError } from './errors';
/** Bounds streamed bodies even when Content-Length is absent or incorrect. */
export async function readBoundedBytes(
  response: Pick<Response, 'headers' | 'body'>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new AppError('response_too_large', 'Response exceeds the supported size.');
  }
  if (!response.body) throw new AppError('invalid_response', 'Empty response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new AppError('response_too_large', 'Response exceeds the supported size.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(response, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AppError('invalid_response', 'Expected a valid JSON response.');
  }
}
