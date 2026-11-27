'use strict';

// Projects bridge the unchanged drawing engines through short-lived snapshots.
// Only the SQLite project and ordinary result PNGs survive a successful call.
const fs = require('node:fs');
const path = require('node:path');
const { loadPaintState, savePaintState } = require('./paint-state.cjs');
const { loadDryState } = require('./dry-state.cjs');
const MIXED = require('./mixed-project.cjs');
const store = () => require('./project-store.cjs');
const own = (o, k) => Object.hasOwn(o, k);
const projectKeys = ['project', 'project_checkpoint', 'project_history_limit', 'project_max_mb', 'project_material'];
const parameters = {
  project: { type: 'string', description: 'Create/open a .qlproject canvas with editable material state, PNG history and checkpoints. Omitting marks creates a blank new canvas. Any brush can be selected on each call. Existing projects own all state inputs and outputs.' },
  project_material: { type: 'string', enum: ['wet', 'dry'], description: 'Legacy optional default brush hint for this project call. Wet suggests oil and dry suggests pencil if no brush is given. The canvas holds all materials and this option does not flatten any paint.' },
  project_checkpoint: { type: 'string', minLength: 1, maxLength: 120, description: 'Optional label (1–120 characters) that pins this saved project step against automatic history pruning.' },
  project_history_limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Recent automatic steps retained, 1–500, plus up to 64 pinned checkpoints. Default 30 for a new project; absent on continuation inherits its limit.' },
  project_max_mb: { type: 'integer', minimum: 64, maximum: 8192, description: 'Project logical storage cap in MiB, 64–8192, default 2048 for a new project. Absent on continuation inherits its cap. SQLite overhead has a bounded allowance.' }
};
function integer(v, lo, hi, name) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi) throw new Error(`${name} must be an integer between ${lo} and ${hi}`);
  return v;
}
function label(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 120 || v.includes('\0')) throw new Error('checkpoint label must contain 1–120 characters');
  return v;
}
function projectPath(v) {
  if (typeof v !== 'string' || !v.trim() || path.extname(v).toLowerCase() !== '.qlproject') throw new Error('project must be a .qlproject path');
  return v;
}
function checkWithoutProject(args) {
  for (const k of projectKeys.slice(1)) if (own(args, k)) throw new Error(`${k} requires project`);
  if (own(args, 'project')) projectPath(args.project);
}
function inside(root, candidate) {
  const r = path.relative(root, candidate);
  return r !== '' && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
}
function exportPath(cwd, requested) {
  if (typeof requested !== 'string' || !requested.trim()) throw new Error('export requires a new target path');
  const root = fs.realpathSync(cwd), target = path.resolve(root, requested);
  if (process.platform === 'win32' && (target.slice(2).includes(':') || target.startsWith('\\\\?\\') || target.startsWith('\\\\.\\'))) throw new Error('unsafe export target path');
  if (!inside(root, target)) throw new Error('export target must be inside the working directory');
  const parent = fs.realpathSync(path.dirname(target));
  if (parent !== root && !inside(root, parent)) throw new Error('export target parent must be inside the working directory');
  return path.join(parent, path.basename(target));
}
async function temporary(cwd, fn) {
  const root = fs.realpathSync(cwd);
  const dir = fs.mkdtempSync(path.join(root, '.quiet-line-project-'));
  // Verify the exact owned directory before any recursive removal, never a caller path.
  const owned = fs.realpathSync(dir);
  if (owned !== dir || path.dirname(owned) !== root || !path.basename(owned).startsWith('.quiet-line-project-')) throw new Error('invalid project temporary directory');
  try { return await fn(owned); }
  finally {
    const stat = fs.lstatSync(owned);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(owned) !== owned) throw new Error('project temporary directory changed; refusing cleanup');
    fs.rmSync(owned, { recursive: true, force: true });
  }
}
function validateState(cwd, file, mode) {
  return mode === 'dry' ? loadDryState(cwd, file) : loadPaintState(cwd, file);
}
function stageError(stage, error) {
  const wrapped = new Error(`Quiet Line project ${stage}: ${error?.message || String(error)}`);
  if (error?.code) wrapped.code = error.code;
  return wrapped;
}
async function executeProject(args, exec, { ctx, execute, outputPath, writeDrawing, attachImage }) {
  let stage = 'validation';
  try {
    projectPath(args.project);
    if (own(args, 'project_material') && !['wet', 'dry'].includes(args.project_material)) throw new Error('project_material must be wet or dry');
    if (args.dry_media != null && typeof args.dry_media !== 'boolean') throw new Error('dry_media must be boolean');
    if (args.project_checkpoint !== undefined) label(args.project_checkpoint);
    if (args.project_history_limit !== undefined) integer(args.project_history_limit, 1, 500, 'project_history_limit');
    if (args.project_max_mb !== undefined) integer(args.project_max_mb, 64, 8192, 'project_max_mb');
    for (const key of ['save_state', 'save_dry_state']) {
      if (own(args, key)) throw new Error(key + ' cannot be used with project; state auto-saves inside the project');
    }
    const inputs = ['base_image', 'paint_state', 'dry_state'];
    if (inputs.filter(key => args[key] != null).length > 1) throw new Error('import one base image or material snapshot');
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
    if (!cwd) throw new Error('the session working directory is unavailable');
    stage = 'read';
    let previous;
    try { previous = await store().readProject(cwd, args.project, { includeData: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      for (const key of inputs) if (own(args, key)) throw new Error('existing project owns state; omit ' + key);
    }
    return await temporary(cwd, async dir => {
      stage = 'drawing';
      const { state, png, info, marks, subject, imported, dryMedia } = await MIXED.drawMixed(cwd, dir, args, previous?.selected, execute, exec);
      exec.signal?.throwIfAborted();
      const requested = outputPath(cwd, args.output === false ? undefined : args.output, info.title, info.seed);
      const target = args.output === false ? undefined : await writeDrawing(cwd, requested, png, {
        continuation: true, explicitOutput: !!args.output?.trim()
      });
      stage = 'commit';
      exec.signal?.throwIfAborted();
      const committed = await store().commitProject(cwd, args.project, {
        mode: 'mixed', state, png, info, label: args.project_checkpoint,
        expectedRevision: previous?.revision ?? null, allowModeSwitch: true,
        historyLimit: args.project_history_limit ?? previous?.historyLimit ?? 30,
        maxBytes: args.project_max_mb === undefined ? previous?.maxBytes ?? 2048 * 1024 * 1024 : args.project_max_mb * 1024 * 1024
      });
      const limits = ctx.get('attachments')?.imageLimits;
      const preview = limits ? await attachImage(ctx, png, path.basename(target ?? requested), limits) : {};
      return {
        ...info, ...preview, subject, marks, bytes: png.length,
        ...(target ? { absolutePath: target, path: path.relative(cwd, target).split(path.sep).join('/') } : {}),
        project: committed.path, projectStep: committed.head, projectRevision: committed.revision, projectMode: 'mixed',
        ...(dryMedia ? { dryMedia: true } : {}),
        ...(imported ? { baseImage: imported.path, resizedBase: imported.resized } : {})
      };
    });
  } catch (error) { throw stageError(stage, error); }
}
const stepSchema = { type: 'integer', minimum: 1, description: 'Saved step ID; defaults to current head when optional.' };
const projectActions = ['list', 'restore', 'checkpoint', 'delete_checkpoint', 'prune', 'branch', 'compact', 'export', 'dry_paint', 'recover'];
const targetActions = ['branch', 'compact', 'export'];
const metadataProperties = {
  path: { type: 'string' }, mode: { type: 'string', enum: ['wet', 'dry', 'mixed'] }, head: { type: 'integer' }, revision: { type: 'integer' },
  historyLimit: { type: 'integer' }, maxBytes: { type: 'integer' },
  steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    id: { type: 'integer' }, mode: { type: 'string', enum: ['wet', 'dry', 'mixed'] }, parentId: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, createdAt: { type: 'string' }, label: { oneOf: [{ type: 'string' }, { type: 'null' }] }, bytes: { type: 'integer' }, pinned: { type: 'boolean' }
  }, required: ['id', 'mode', 'parentId', 'createdAt', 'label', 'bytes', 'pinned'] } }
};
function renderProject(args, value) {
  const lines = [`Project: ${value.path}`, `Mode: ${value.mode}; head: ${value.head}; revision: ${value.revision}; history: ${value.historyLimit}; cap: ${value.maxBytes} bytes.`];
  if (args.action === 'dry_paint') lines.push('The wet oil paint has been explicitly dried as a new project step. The visible PNG and paint relief are unchanged; subsequent oil strokes do not pick up dried pigment.');
  if (value.target) lines.push(`Exported: ${value.target}${value.exportedMode ? ` (${value.exportedMode} material)` : ''}`);
  for (const s of value.steps) lines.push(`${s.id === value.head ? '*' : ' '} Step ${s.id} (${s.mode}; parent ${s.parentId ?? 'none'})${s.pinned ? ` [checkpoint: ${s.label}]` : ''} — ${s.bytes} bytes, ${s.createdAt}`);
  return [{ type: 'text', text: lines.join('\n') }];
}
function createProjectTool(ctx) {
  return {
    name: 'quiet_line_project',
    description: 'Manage a single Quiet Line .qlproject file: list metadata/history, restore a saved step (retaining later history), pin a checkpoint, delete_checkpoint, prune automatic history/change limits, branch to a NEW .qlproject, export a selected step to a NEW .png/.qlpaint/.qldry, explicitly dry the current wet oil paint without changing its visible PNG or relief, or recover a safely contained project after interrupted SQLite writes and run a full integrity check. Recovery preserves history/revision and refuses unsafe files or active locks. No image attachment is needed. Continue drawing with quiet_line_draw project; project state is never overwritten by an import.',
    parameters: { type: 'object', additionalProperties: false, required: ['project', 'action'], properties: {
      project: parameters.project, action: { type: 'string', enum: projectActions, description: 'dry_paint dries oil pigment in the current step, if present, while retaining its visible PNG and relief and the rest of the artwork. Normal history pruning applies; pin or branch first to preserve the previous wet step.' },
      step: stepSchema, label: { type: 'string', minLength: 1, maxLength: 120, description: 'Required checkpoint label.' },
      target: { type: 'string', description: 'Required NEW path for branch (.qlproject) or export (.png/.qlpaint/.qldry); inside working directory, existing parent, never overwrites.' },
      history_limit: { type: 'integer', minimum: 1, maximum: 500 }, max_mb: { type: 'integer', minimum: 64, maximum: 8192 }
    } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ...metadataProperties, target: { type: 'string' }, exportedMode: { type: 'string', enum: ['wet', 'dry', 'mixed'] } }, required: ['path', 'mode', 'head', 'revision', 'historyLimit', 'maxBytes', 'steps'] }, render: renderProject },
    // Full-history copies can verify several GiB of stored paint in one call.
    timeoutMs: 600000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      let stage = 'validation';
      try {
        if (!exec.agent) throw new Error('quiet_line_project needs an owning Agent session');
        projectPath(args.project);
        if (!projectActions.includes(args.action)) throw new Error('unknown project action');
        if (args.step !== undefined) integer(args.step, 1, Number.MAX_SAFE_INTEGER, 'step');
        if (args.label !== undefined) label(args.label);
        if (args.action === 'checkpoint' && args.label === undefined) throw new Error('checkpoint requires label');
        if (args.label !== undefined && args.action !== 'checkpoint') throw new Error('label is only for checkpoint');
        if (args.target !== undefined && !targetActions.includes(args.action)) throw new Error('target is only for branch, compact or export');
        if (targetActions.includes(args.action) && args.target === undefined) throw new Error(`${args.action} requires target`);
        if (args.action !== 'prune' && (args.history_limit !== undefined || args.max_mb !== undefined)) throw new Error('history_limit/max_mb are only for prune');
        if (args.history_limit !== undefined) integer(args.history_limit, 1, 500, 'history_limit');
        if (args.max_mb !== undefined) integer(args.max_mb, 64, 8192, 'max_mb');
        if (args.step !== undefined && ['list', 'prune', 'recover', 'dry_paint', 'compact'].includes(args.action)) throw new Error(`step is not used by ${args.action}`);
        const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
        if (!cwd) throw new Error('the session working directory is unavailable');
        if (args.action === 'recover') {
          stage = 'recover';
          if (exec.signal?.aborted) throw new Error('project recovery cancelled');
          // A hot rollback journal intentionally makes normal readProject fail.
          // Let the store acquire SQLite locks and recover before reading metadata.
          return await store().manageProject(cwd, args.project, { action: 'recover' });
        }
        stage = 'read';
        const previous = await store().readProject(cwd, args.project, { step: args.step, includeData: ['export', 'dry_paint'].includes(args.action) });
        if (args.action === 'list') return previous;
        if (args.action === 'export') {
          stage = 'export';
          const target = exportPath(cwd, args.target), ext = path.extname(target).toLowerCase();
          const selectedMode = previous.selected.mode;
          const snapshotMode = ext === '.qldry' ? 'dry' : ext === '.qlpaint' ? 'wet' : null;
          let bytes = previous.selected.png;
          if (ext !== '.png') {
            if (!snapshotMode || (selectedMode !== 'mixed' && selectedMode !== snapshotMode)) {
              const extensions = selectedMode === 'mixed' ? '.qlpaint or .qldry' : selectedMode === 'wet' ? '.qlpaint' : '.qldry';
              throw new Error('export target must end in .png or ' + extensions);
            }
            bytes = await temporary(cwd, async dir => {
              if (selectedMode === 'mixed') {
                return MIXED.exportMaterial(cwd, dir, MIXED.unpack(previous.selected.state), previous.selected.info, snapshotMode);
              }
              const input = path.join(dir, 'validate' + ext);
              fs.writeFileSync(input, previous.selected.state, { flag: 'wx' });
              await validateState(cwd, input, selectedMode);
              return previous.selected.state;
            });
          }
          if (exec.signal?.aborted) throw new Error('export cancelled');
          fs.writeFileSync(target, bytes, { flag: 'wx' });
          const { selected, ...metadata } = previous;
          return { ...metadata, target, exportedMode: snapshotMode ?? selectedMode };
        }
        if (args.action === 'dry_paint') {
          stage = 'dry paint';
          const selected = previous.selected;
          const mixed = selected.mode === 'mixed' ? MIXED.unpack(selected.state) : null;
          const wet = mixed ? mixed.wet : selected.mode === 'wet' ? selected.state : null;
          if (!wet) throw new Error('dry_paint requires oil pigment in the current project step');
          return await temporary(cwd, async dir => {
            const input = path.join(dir, 'input.qlpaint'), output = path.join(dir, 'output.qlpaint');
            fs.writeFileSync(input, wet, { flag: 'wx' });
            const snapshot = loadPaintState(cwd, input);
            require('./oil.cjs').dryOilState(snapshot.oil);
            savePaintState(cwd, output, snapshot);
            if (exec.signal?.aborted) throw new Error('dry paint cancelled before project commit');
            const painted = fs.readFileSync(output);
            return await store().commitProject(cwd, args.project, {
              mode: selected.mode, state: mixed ? MIXED.pack({ ...mixed, wet: painted }) : painted, png: selected.png, info: selected.info,
              expectedRevision: previous.revision, historyLimit: previous.historyLimit, maxBytes: previous.maxBytes
            });
          });
        }
        stage = args.action;
        if (exec.signal?.aborted) throw new Error('project operation cancelled');
        return await store().manageProject(cwd, args.project, { action: args.action, step: args.step, label: args.label, target: args.target,
          historyLimit: args.history_limit, maxBytes: args.max_mb === undefined ? undefined : args.max_mb * 1024 * 1024, expectedRevision: previous.revision });
      } catch (error) { throw stageError(stage, error); }
    },
    presentCall(args) { return { card: 'generic', title: `Project ${args?.action || 'manage'}`, kind: 'other' }; }
  };
}
module.exports = { parameters, executeProject, checkWithoutProject, createProjectTool };
