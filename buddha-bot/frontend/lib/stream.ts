export type StreamEvent = { type: string; text?: string; state?: string; expression?: string; message?: string };
export async function consume(response: Response, receive: (event: StreamEvent) => void) {
 if (!response.ok) throw new Error(response.status === 409 ? 'The guide is finishing another response. Try again shortly.' : 'Cannot reach the guide. Check that the local backend is running.');
 if (!response.body) throw new Error('This browser did not provide a response stream.');
 const reader = response.body.getReader();
 const decoder = new TextDecoder();
 let buffer = '', doneEvent = false;
 try {
  while (true) {
   const { value, done } = await reader.read();
   buffer += decoder.decode(value, {stream: !done}).replace(/\r\n/g, '\n');
   let boundary;
   while ((boundary = buffer.indexOf('\n\n')) >= 0) {
    const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data) { const event = JSON.parse(data) as StreamEvent; receive(event); if (event.type === 'done') doneEvent = true; }
   }
   if (done) break;
  }
  if (!doneEvent) throw new Error('The connection ended early. Please retry.');
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
