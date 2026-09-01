import { describe, it, expect } from 'vitest';
import {
  applyEventToMessages,
  toModelHistory,
  type ReedyAssistantMessage,
  type ReedyMessage,
} from '@/services/reedy/store/reedyStore';
import { makeToolError } from '@/services/reedy/runtime/errors';
import type { ReedyEvent } from '@/services/reedy/runtime/events';

function baseAssistant(id: string): ReedyAssistantMessage {
  return { id, role: 'assistant', parts: [], createdAt: 0 };
}

describe('reedyStore — applyEventToMessages reducer', () => {
  it('returns the input array unchanged when no matching assistant message exists', () => {
    const before: ReedyMessage[] = [{ id: 'u1', role: 'user', text: 'hi', createdAt: 0 }];
    const after = applyEventToMessages(before, 'missing', {
      type: 'text_delta',
      delta: 'x',
    });
    expect(after).toBe(before);
  });

  it('coalesces consecutive text_delta events into one text part', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', { type: 'text_delta', delta: 'Hello, ' });
    msgs = applyEventToMessages(msgs, 'a1', { type: 'text_delta', delta: 'world.' });
    const assistant = msgs[0] as ReedyAssistantMessage;
    expect(assistant.parts).toHaveLength(1);
    expect(assistant.parts[0]).toEqual({ type: 'text', text: 'Hello, world.' });
  });

  it('skips zero-length text_delta', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', { type: 'text_delta', delta: '' });
    const assistant = msgs[0] as ReedyAssistantMessage;
    expect(assistant.parts).toEqual([]);
  });

  it('appends a tool_call part in pending state', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'tool_call',
      id: 'tc1',
      name: 'lookupPassage',
      args: { query: 'alice' },
      permission: 'read',
    });
    const part = (msgs[0] as ReedyAssistantMessage).parts[0]!;
    expect(part.type).toBe('tool_call');
    if (part.type === 'tool_call') {
      expect(part.state).toBe('pending');
      expect(part.name).toBe('lookupPassage');
    }
  });

  it('tool_result ok transitions the matching tool_call to state=ok with result', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'tool_call',
      id: 'tc1',
      name: 'find',
      args: { q: 'x' },
      permission: 'read',
    });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'tool_result',
      id: 'tc1',
      name: 'find',
      ok: true,
      result: { hit: 'x' },
      durationMs: 42,
    });
    const part = (msgs[0] as ReedyAssistantMessage).parts[0]!;
    if (part.type === 'tool_call') {
      expect(part.state).toBe('ok');
      expect(part.result).toEqual({ hit: 'x' });
      expect(part.durationMs).toBe(42);
    }
  });

  it('tool_result error transitions the matching tool_call to state=error', () => {
    const err = makeToolError('tool_runtime_error', 'find', 'boom');
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'tool_call',
      id: 'tc2',
      name: 'find',
      args: {},
      permission: 'read',
    });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'tool_result',
      id: 'tc2',
      name: 'find',
      ok: false,
      error: err,
    });
    const part = (msgs[0] as ReedyAssistantMessage).parts[0]!;
    if (part.type === 'tool_call') {
      expect(part.state).toBe('error');
      expect(part.error?.kind).toBe('tool_runtime_error');
    }
  });

  it('tool_result with no matching tool_call leaves parts untouched', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'tool_result',
      id: 'orphan',
      name: 'find',
      ok: true,
      result: {},
      durationMs: 0,
    });
    expect((msgs[0] as ReedyAssistantMessage).parts).toEqual([]);
  });

  it('appends citation parts in arrival order', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'citation',
      cfi: 'epubcfi(/6/2)',
      sectionIndex: 0,
      chapterTitle: 'Ch1',
      snippet: 'first',
    });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'citation',
      cfi: 'epubcfi(/6/4)',
      sectionIndex: 1,
      snippet: 'second',
    });
    const parts = (msgs[0] as ReedyAssistantMessage).parts;
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.type === 'citation')).toBe(true);
  });

  it('error event appends an error part without dropping prior content', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', { type: 'text_delta', delta: 'partial' });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'error',
      kind: 'model_error',
      message: 'upstream 500',
      retryable: true,
    });
    const parts = (msgs[0] as ReedyAssistantMessage).parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]!.type).toBe('text');
    expect(parts[1]!.type).toBe('error');
  });

  it('abort event appends an abort part with the partial flag', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', { type: 'abort', partial: true });
    const part = (msgs[0] as ReedyAssistantMessage).parts[0]!;
    expect(part).toEqual({ type: 'abort', partial: true });
  });

  it('done event captures finishReason + usage on the assistant message', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    const ev: ReedyEvent = {
      type: 'done',
      output: {
        sessionId: 's1',
        assistantMessageId: 'a1',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      },
    };
    msgs = applyEventToMessages(msgs, 'a1', ev);
    const assistant = msgs[0] as ReedyAssistantMessage;
    expect(assistant.finishReason).toBe('stop');
    expect(assistant.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });

  it('non-structural events (turn_start, step_finish, usage, memory_write) leave parts unchanged', () => {
    let msgs: ReedyMessage[] = [baseAssistant('a1')];
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'turn_start',
      sessionId: 's1',
      assistantMessageId: 'a1',
    });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'step_finish',
      step: 0,
      reason: 'stop',
    });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'usage',
      promptTokens: 10,
      completionTokens: 5,
    });
    msgs = applyEventToMessages(msgs, 'a1', {
      type: 'memory_write',
      scope: 'book',
      key: 'k',
      summary: 's',
    });
    expect((msgs[0] as ReedyAssistantMessage).parts).toEqual([]);
  });
});

describe('reedyStore — toModelHistory', () => {
  it('returns an empty array for an empty log', () => {
    expect(toModelHistory([])).toEqual([]);
  });

  it('carries user text and assistant text forward, in order', () => {
    const msgs: ReedyMessage[] = [
      { id: 'u1', role: 'user', text: 'what is entropy?', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Entropy is ' },
          { type: 'text', text: 'a measure.' },
        ],
        createdAt: 1,
      },
      { id: 'u2', role: 'user', text: 'simpler please', createdAt: 2 },
    ];
    expect(toModelHistory(msgs)).toEqual([
      { role: 'user', content: 'what is entropy?' },
      { role: 'assistant', content: 'Entropy is a measure.' },
      { role: 'user', content: 'simpler please' },
    ]);
  });

  it('drops tool calls, citations, and errors from assistant history', () => {
    const msgs: ReedyMessage[] = [
      { id: 'u1', role: 'user', text: 'hi', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            id: 't1',
            name: 'lookupPassage',
            args: {},
            permission: 'read',
            state: 'ok',
          },
          { type: 'text', text: 'answer' },
          { type: 'citation', cfi: 'epubcfi(/6/4!/4)', sectionIndex: 0, snippet: 'x' },
        ],
        createdAt: 1,
      },
    ];
    expect(toModelHistory(msgs)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'answer' },
    ]);
  });

  it('skips assistant messages with no text', () => {
    const msgs: ReedyMessage[] = [
      { id: 'u1', role: 'user', text: 'hi', createdAt: 0 },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'error', message: 'boom', kind: 'model_error' }],
        createdAt: 1,
      },
      { id: 'u2', role: 'user', text: 'again', createdAt: 2 },
    ];
    expect(toModelHistory(msgs)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'again' },
    ]);
  });
});
