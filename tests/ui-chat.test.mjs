import { test } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

test('chat UI renders correct elements', () => {
  const dom = new JSDOM('<!DOCTYPE html><div id="content"></div><div id="welcome" hidden></div>');
  global.document = dom.window.document;
  global.active = () => ({ messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }] });
  global.renderMessage = (m) => `<article class="chat-message from-${m.role}"><div class="bubble ${m.role}">${m.text}</div></article>`;
  global.bindInterface = () => {};
  
  // Simulate render
  const content = document.getElementById('content');
  const welcome = document.getElementById('welcome');
  const c = active();
  welcome.hidden = true;
  content.innerHTML = c.messages.map(renderMessage).join('');

  assert.strictEqual(content.querySelectorAll('.from-user').length, 1);
  assert.strictEqual(content.querySelectorAll('.from-assistant').length, 1);
  assert.strictEqual(content.querySelectorAll('.bubble.user').length, 1);
});