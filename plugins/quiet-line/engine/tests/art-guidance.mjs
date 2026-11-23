import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { apply } from '../index.js';
const require = createRequire(import.meta.url);
const { ART_GUIDANCE } = require('../lib/art-guidance.cjs');
const tools = new Map();
apply({ tools: { register(t) { tools.set(t.name, t); } } });
const draw = tools.get('quiet_line_draw');
const manage = tools.get('quiet_line_project');
assert.ok(draw.description.endsWith(ART_GUIDANCE), 'Guidance must reach the registered model-visible tool');
for (const [name, pattern] of [
  ['composition and hierarchy', /format, crop, focal point.*negative spaces/],
  ['perspective construction', /eye level\/horizon.*perspective system/],
  ['convergence and ellipses', /vanishing points[\s\S]*foreshortening[\s\S]*ellipses/],
  ['diffuse/specular/material lighting', /diffuse light[\s\S]*view-dependent specular[\s\S]*roughness/],
  ['flexible process', /optional scaffold: combine, reorder, revisit or skip stages/],
  ['thin oil approximation', /thin, low-opacity paint[\s\S]*not solvent physics/],
  ['low-load depletion caveat', /Low load can run dry early[\s\S]*keep enough load and lower opacity\/impasto/],
  ['3D-to-2D aids and inspection', /3D-to-2D aids[\s\S]*Actually inspect aids/],
  ['reference constraints', /permissions and user constraints[\s\S]*paid services, uploads or software installation/],
  ['mixed project materials', /retain their separate states across tool changes[\s\S]*dry pigment remains erasable and smudgeable/],
  ['width multipliers', /width is a multiplier, not pixels \(0\.1\.\.30\); controls\.width[\s\S]*\(0\.\.3\)/],
  ['purposeful iteration', /Do not fear overworking[\s\S]*Do not loop indefinitely/]
]) assert.match(ART_GUIDANCE, pattern, name);
assert.ok(ART_GUIDANCE.split(/\s+/).length <= 650, 'Keep repeatedly loaded craft guidance compact');
const props = draw.parameters.properties;
assert.deepEqual(props.project_material.enum, ['wet', 'dry']);
assert.equal(props.strokes.items.properties.width.minimum, .1);
assert.equal(props.strokes.items.properties.width.maximum, 30);
assert.equal(props.strokes.items.properties.controls.items.properties.width.maximum, 3);
assert.equal(props.operations.items.properties.width.maximum, 30);
assert.equal(draw.output.schema.properties.projectTransition.type, 'string');
assert.ok(manage.output.schema.properties.steps.items.properties.mode);
console.log('art guidance: PASS — registered description, flexible craft advice and advertised material/width contracts');
