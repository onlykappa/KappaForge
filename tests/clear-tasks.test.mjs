import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../preview/app-tasks.js', import.meta.url), 'utf8');

test('clearAllTasks removes all jobs and storage entries', () => {
  const box = {
    trackedJobs: [{number:1}],
    localStorage: {
      store: new Map(),
      getItem(k){return this.store.get(k)||null;},
      setItem(k,v){this.store.set(k,v);},
      removeItem(k){this.store.delete(k);},
    },
    persistJobs(){},
    render(){},
    // Minimal globals required by the script
    KappaProgress:{recoveryReceipt(){},},
    KappaJobs:{},
    KappaActions:{},
    JSON,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    console,
    save(){},
    toast(){},
    taskCheckpoint(){},
    ensureTaskCard(){},
    taskRetryPending:new Set(),
  };

  // Simulate an existing stored jobs entry
  box.localStorage.setItem('kappaforge.jobs.v2', JSON.stringify([{number:2}]));

  vm.createContext(box);
  vm.runInContext(src, box);

  // Call the new function
  box.clearAllTasks();

  assert.deepEqual(box.trackedJobs, []);
  assert.equal(box.localStorage.getItem('kappaforge.jobs.v2'), null);
});