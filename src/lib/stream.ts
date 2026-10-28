/**
 * Minimal NDJSON (one JSON object per line) parser for the streaming chat response.
 * Chunks from the network can split a line anywhere, so partial lines are buffered.
 */
export function createLineParser(onEvent: (event: any) => void) {
  let buffer = "";
  const emit = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return; // ignore a malformed line instead of killing the whole answer
    }
    onEvent(event);
  };
  return {
    push(text: string) {
      buffer += text;
      let i: number;
      while ((i = buffer.indexOf("\n")) >= 0) {
        emit(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    },
    flush() {
      emit(buffer);
      buffer = "";
    },
  };
}
