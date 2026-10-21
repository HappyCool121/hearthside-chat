export type Message = { role: 'user' | 'assistant'; content: string };
const bytes = (messages: Message[]) => new TextEncoder().encode(JSON.stringify(messages)).byteLength;
export function trimHistory(messages: Message[], maxMessages = 14, maxBytes = 12_000) {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid history limits.');
  const result = messages.slice();
  let removed = 0;
  while (result.length > 1 && (result.length > maxMessages || bytes(result) > maxBytes)) {
    result.shift(); removed++;
  }
  // Never truncate or drop the newest user message to make a request fit.
  if (bytes(result) > maxBytes) throw new Error('Your latest message is too long. Please shorten it.');
  return { messages: result, removed };
}
